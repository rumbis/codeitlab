#!/usr/bin/env python3
"""Train CodeitLab's tiny credentials model.

The credentials proxy runs a very small classifier over suspicious tokens (the
ones patterns did not already catch) to decide whether a bare string looks like
a credential. It has to be tiny, offline, deterministic and fast: a hashed
character n-gram logistic regression, a few thousand int8 weights.

Run from the repository root:

    python3 scripts/credentials-model/train.py

It writes:
  packages/codeitlab/src/credentials/model-weights.ts  (bundled default)
  scripts/credentials-model/model.json                 (downloadable/release copy)

The feature extraction here must stay byte-for-byte in step with
packages/codeitlab/src/credentials/model.ts; the TS tests assert the same
examples the training script reports.
"""

from __future__ import annotations

import json
import math
import random
import re
from pathlib import Path

import numpy as np

BUCKETS = 8192
NGRAMS = (3, 4, 5)
MODEL_ID = "codeitlab-tiny-credentials"
MODEL_VERSION = "1.0.0"
CANDIDATE = re.compile(r"[A-Za-z0-9+/_=.\-]{12,}")

SECRET_WORDS = (
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "api-key",
    "key",
    "credential",
    "auth",
    "bearer",
    "private",
)

DENSE_NAMES = [
    "bias",
    "len_lt12",
    "len_12_19",
    "len_20_31",
    "len_32_47",
    "len_ge48",
    "digit_lt015",
    "digit_015_04",
    "digit_04_07",
    "digit_ge07",
    "mixed_case",
    "all_upper",
    "all_lower",
    "has_symbol",
    "hex_like",
    "uuid_like",
    "path_like",
    "known_prefix",
    "ctx_password",
    "ctx_secret",
    "ctx_token",
    "ctx_auth",
    "ctx_key",
    "ctx_credential",
    "ctx_bearer",
    "ctx_none",
    "entropy_lt25",
    "entropy_25_35",
    "entropy_35_45",
    "entropy_ge45",
    "has_dash",
    "has_underscore",
    "has_dot",
    "has_digit_and_letter",
    "base64ish",
    "upper_lt03",
    "upper_03_07",
    "upper_ge07",
    "len_16_24",
    "len_24_40",
    "codeish",
]

KNOWN_PREFIXES = (
    "sk-ant-api03-",
    "sk-ant-",
    "sk-proj-",
    "sk-",
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "ghr_",
    "github_pat_",
    "glpat-",
    "AKIA",
    "ASIA",
    "AIza",
    "xoxb-",
    "xoxp-",
    "xoxa-",
    "xoxr-",
    "npm_",
    "sk_live_",
    "rk_live_",
    "whsec_",
)


def fnv1a32(text: str) -> int:
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = {}
    for char in value:
        counts[char] = counts.get(char, 0) + 1
    total = len(value)
    return -sum((count / total) * math.log2(count / total) for count in counts.values())


def ratio(chars: str, value: str) -> float:
    return sum(1 for char in value if char in chars) / len(value) if value else 0.0


def dense_features(token: str, context: str) -> list[int]:
    lower = token.lower()
    ctx = context.lower()
    length = len(token)
    digits = ratio("0123456789", token)
    ent = entropy(token)
    has_secret_context = any(word in ctx for word in SECRET_WORDS)
    upper = ratio("ABCDEFGHIJKLMNOPQRSTUVWXYZ", token)
    base64ish = bool(re.fullmatch(r"[A-Za-z0-9+/_-]+={0,2}", token))
    codeish = bool(
        re.fullmatch(r"[a-z]+[A-Z][A-Za-z0-9]*", token)
        or re.fullmatch(r"[a-z0-9]+_[a-z0-9_]+", token)
        or "/" in token
        or "." in token
    )
    features = [1]  # bias
    features += [
        1 if length < 12 else 0,
        1 if 12 <= length < 20 else 0,
        1 if 20 <= length < 32 else 0,
        1 if 32 <= length < 48 else 0,
        1 if length >= 48 else 0,
        1 if digits < 0.15 else 0,
        1 if 0.15 <= digits < 0.4 else 0,
        1 if 0.4 <= digits < 0.7 else 0,
        1 if digits >= 0.7 else 0,
        1 if any(c.isupper() for c in token) and any(c.islower() for c in token) else 0,
        1 if token.isupper() else 0,
        1 if token.islower() else 0,
        1 if any(not c.isalnum() for c in token) else 0,
        1 if re.fullmatch(r"[0-9a-fA-F]+", token) else 0,
        1 if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", lower) else 0,
        1 if "/" in token else 0,
        1 if any(token.startswith(prefix) for prefix in KNOWN_PREFIXES) else 0,
        1 if "password" in ctx or "passwd" in ctx or "pwd" in ctx else 0,
        1 if "secret" in ctx else 0,
        1 if "token" in ctx else 0,
        1 if "auth" in ctx else 0,
        1 if "key" in ctx else 0,
        1 if "credential" in ctx else 0,
        1 if "bearer" in ctx else 0,
        1 if not has_secret_context else 0,
        1 if ent < 2.5 else 0,
        1 if 2.5 <= ent < 3.5 else 0,
        1 if 3.5 <= ent < 4.5 else 0,
        1 if ent >= 4.5 else 0,
        1 if "-" in token else 0,
        1 if "_" in token else 0,
        1 if "." in token else 0,
        1 if any(c.isdigit() for c in token) and any(c.isalpha() for c in token) else 0,
        1 if base64ish else 0,
        1 if upper < 0.3 else 0,
        1 if 0.3 <= upper < 0.7 else 0,
        1 if upper >= 0.7 else 0,
        1 if 16 <= length < 24 else 0,
        1 if 24 <= length < 40 else 0,
        1 if codeish else 0,
    ]
    return features


def feature_indices(token: str, context: str) -> list[int]:
    lower = token.lower()
    indices = []
    for n in NGRAMS:
        for i in range(len(lower) - n + 1):
            indices.append(fnv1a32(f"g{n}:{lower[i : i + n]}") % BUCKETS)
    indices.extend(BUCKETS + i for i, on in enumerate(dense_features(token, context)) if on)
    return indices


TOTAL_FEATURES = BUCKETS + len(DENSE_NAMES)


# ---------------------------------------------------------------------------
# Synthetic data
# ---------------------------------------------------------------------------

rng = random.Random(20261023)
ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
BASE62_ALNUM = ALNUM
BASE64URL = ALNUM + "-_"
HEX = "0123456789abcdef"
LOWER = "abcdefghijklmnopqrstuvwxyz"


def rand(alphabet: str, length: int) -> str:
    return "".join(rng.choice(alphabet) for _ in range(length))


def plant_api_key() -> str:
    shape = rng.choice(
        [
            ("sk-", BASE62_ALNUM, 48),
            ("sk-proj-", BASE64URL, 40),
            ("sk-ant-api03-", BASE64URL, 40),
            ("ghp_", ALNUM, 36),
            ("gho_", ALNUM, 36),
            ("glpat-", BASE64URL, 20),
            ("npm_", ALNUM, 36),
            ("xoxb-", ALNUM, 24),
            ("whsec_", BASE64URL, 32),
            ("key_", ALNUM, 32),
            ("tok_", BASE64URL, 32),
        ]
    )
    prefix, alphabet, length = shape
    return prefix + rand(alphabet, length)


def plant_hex_token() -> str:
    return rand(HEX, rng.choice([32, 40, 64]))


def plant_password() -> str:
    return rand(ALNUM + "!@#$%^&*", rng.choice([10, 12, 16, 20, 24]))


def plant_base64() -> str:
    return rand(BASE64URL, rng.choice([24, 32, 44, 64, 88]))


def positive_examples() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    templates = [
        ("The key is {v}", "key"),
        ("api_key = {v}", "api_key"),
        ("export OPENAI_API_KEY={v}", "OPENAI_API_KEY"),
        ("Authorization: Bearer {v}", "Bearer"),
        ("password: {v}", "password"),
        ("client_secret={v}", "client_secret"),
        ("token={v}", "token"),
        ("DATABASE_URL=postgres://user:{v}@db.internal:5432/app", "postgres"),
        ("Here is the credential: {v}", "credential"),
        ("secret = {v}", "secret"),
        ("auth_token: {v}", "auth_token"),
        ("private_key = {v}", "private_key"),
        ("the password is {v}", "password"),
        ("X-Api-Key: {v}", "X-Api-Key"),
    ]
    for _ in range(3200):
        template, context = rng.choice(templates)
        if "postgres" in context:
            value = plant_password()
        elif rng.random() < 0.5:
            value = plant_api_key()
        elif rng.random() < 0.5:
            value = plant_hex_token()
        elif rng.random() < 0.5:
            value = plant_password()
        else:
            value = plant_base64()
        out.append((template.format(v=value), context))
    # A few context-free blobs still look like credentials by shape alone.
    for _ in range(150):
        out.append((f"{{ {plant_api_key()} }}", ""))
    return out


def negative_examples() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    identifiers = [
        "getUserById",
        "parse_connection_string",
        "AbstractSingletonProxyFactoryBean",
        "resolveWorkspaceRootPath",
        "t3_code_thread_metadata",
        "CodeitlabCredentialsEngine",
        "SOME_CONSTANT_NAME",
        "handleSubmitClick",
    ]
    for _ in range(2500):
        kind = rng.random()
        if kind < 0.18:
            token = str(
                __import__("uuid").UUID(int=rng.getrandbits(128))
            )
            text = f"session_id: {token}"
        elif kind < 0.34:
            token = rand(HEX, rng.choice([32, 40, 64]))
            text = f"checksum: {token}"
        elif kind < 0.46:
            token = rand(ALNUM + "-_", rng.choice([12, 16, 24, 32]))
            text = f"image: {token}"
        elif kind < 0.60:
            token = rng.choice(identifiers)
            text = f"function {token}() {{}}"
        elif kind < 0.70:
            token = f"/Users/{rng.choice(['rumbis', 'dev', 'alice'])}/projects/{rand(LOWER, 8)}/src/index.ts"
            text = f"path: {token}"
        elif kind < 0.78:
            token = f"{rng.randint(0, 3)}.{rng.randint(0, 20)}.{rng.randint(0, 9)}"
            text = f"version: {token}"
        elif kind < 0.86:
            token = f"{rng.choice(['feat', 'fix', 'chore'])}-{rand(LOWER, 6)}-{rng.randint(100, 9999)}"
            text = f"branch: {token}"
        elif kind < 0.90:
            token = rand(LOWER, rng.choice([12, 16, 24]))
            text = f"word: {token}"
        elif kind < 0.95:
            token = rand(BASE64URL, rng.choice([16, 24, 32]))
            text = f"image_data: {token}"
        else:
            token = f"2026-10-{rng.randint(10, 28)}T{rng.randint(0, 23)}:{rng.randint(0, 59)}:00Z"
            text = f"created: {token}"
        out.append((text, ""))
    return out


def dataset() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    rows: list[list[int]] = []
    labels: list[int] = []
    for text, context in positive_examples():
        for match in CANDIDATE.finditer(text):
            token = match.group(0)
            if token in text and token not in ("",):
                prefix = text[: match.start()]
                ctx = (prefix + " " + context)[-48:]
                rows.append(feature_indices(token, ctx))
                labels.append(1)
    for text, context in negative_examples():
        for match in CANDIDATE.finditer(text):
            token = match.group(0)
            prefix = text[: match.start()]
            ctx = (prefix + " " + context)[-48:]
            rows.append(feature_indices(token, ctx))
            labels.append(0)
    indices = list(range(len(rows)))
    rng.shuffle(indices)
    split = int(len(indices) * 0.85)
    train_idx, test_idx = indices[:split], indices[split:]

    def matrix(selected: list[int]) -> np.ndarray:
        m = np.zeros((len(selected), TOTAL_FEATURES), dtype=np.float32)
        for row, idx in enumerate(selected):
            m[row, rows[idx]] = 1.0
        return m

    return (
        matrix(train_idx),
        np.array([labels[i] for i in train_idx], dtype=np.float32),
        matrix(test_idx),
        np.array([labels[i] for i in test_idx], dtype=np.float32),
    )


def train() -> dict:
    x_train, y_train, x_test, y_test = dataset()
    weights = np.zeros(TOTAL_FEATURES, dtype=np.float32)
    bias = np.float32(0.0)
    lr = 0.5
    for epoch in range(60):
        logits = x_train @ weights + bias
        probs = 1.0 / (1.0 + np.exp(-logits))
        error = probs - y_train
        grad = (x_train.T @ error) / len(y_train) + 1e-5 * weights
        weights -= lr * grad
        bias -= lr * float(np.mean(error))
        lr *= 0.97
        if epoch % 10 == 0:
            test_logits = x_test @ weights + bias
            test_probs = 1.0 / (1.0 + np.exp(-test_logits))
            pred = (test_probs >= 0.5).astype(np.float32)
            acc = float(np.mean(pred == y_test))
            print(f"epoch {epoch:2d} acc {acc:.4f}")
    test_probs = 1.0 / (1.0 + np.exp(-(x_test @ weights + bias)))
    thresholds = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    metrics = {}
    for threshold in thresholds:
        pred = (test_probs >= threshold).astype(np.float32)
        tp = float(np.sum((pred == 1) & (y_test == 1)))
        fp = float(np.sum((pred == 1) & (y_test == 0)))
        fn = float(np.sum((pred == 0) & (y_test == 1)))
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        metrics[str(threshold)] = {"precision": round(precision, 4), "recall": round(recall, 4)}
        print(f"threshold {threshold:.1f} precision {precision:.4f} recall {recall:.4f}")

    # False positives are expensive (masking a git SHA in a diff breaks the
    # agent's answer), so pick the lowest threshold with very high precision.
    chosen = 0.5
    for threshold in (0.5, 0.6, 0.7, 0.8):
        if metrics[str(threshold)]["precision"] >= 0.99:
            chosen = threshold
            break

    scale = float(np.max(np.abs(weights))) / 127.0 or 1e-4
    quantized = np.clip(np.round(weights / scale), -127, 127).astype(np.int32)

    return {
        "id": MODEL_ID,
        "version": MODEL_VERSION,
        "algorithm": "hashed-char-ngram-logreg-int8",
        "buckets": BUCKETS,
        "ngrams": list(NGRAMS),
        "denseFeatures": DENSE_NAMES,
        "scale": scale,
        "bias": float(bias),
        "threshold": chosen,
        "weights": [int(value) for value in quantized],
        "metrics": metrics,
        "trainedAt": "2026-10-23",
        "license": "MIT (synthetic training data, generated in this script)",
    }


def main() -> None:
    model = train()
    root = Path(__file__).resolve().parents[2]
    weights_path = root / "packages/codeitlab/src/credentials/model-weights.ts"
    json_path = Path(__file__).resolve().parent / "model.json"

    weights_literal = ",\n".join(
        ", ".join(str(value) for value in model["weights"][i : i + 32])
        for i in range(0, len(model["weights"]), 32)
    )
    ts = f'''// Generated by scripts/credentials-model/train.py — do not edit by hand.
// Tiny hashed character n-gram credential classifier; {len(model["weights"])} int8 weights.

export const BUNDLED_CREDENTIAL_MODEL = {{
  id: "{model["id"]}",
  version: "{model["version"]}",
  algorithm: "{model["algorithm"]}",
  buckets: {model["buckets"]},
  ngrams: {json.dumps(model["ngrams"])},
  denseFeatures: {json.dumps(model["denseFeatures"])},
  scale: {model["scale"]!r},
  bias: {model["bias"]!r},
  threshold: {model["threshold"]!r},
  weights: [
{weights_literal},
  ],
}} as const;
'''
    weights_path.write_text(ts, encoding="utf-8")
    json_path.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {weights_path} ({len(model['weights'])} weights)")
    print(f"wrote {json_path}")


if __name__ == "__main__":
    main()
