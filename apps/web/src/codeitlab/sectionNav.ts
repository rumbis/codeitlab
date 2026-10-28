import {
  BotIcon,
  BrainIcon,
  BoxesIcon,
  BugIcon,
  ClapperboardIcon,
  Columns3Icon,
  CpuIcon,
  HandshakeIcon,
  ImageIcon,
  LayersIcon,
  PencilIcon,
  StoreIcon,
  KeyRoundIcon,
  NetworkIcon,
  PaletteIcon,
  RocketIcon,
  SearchIcon,
  WalletIcon,
  ShieldIcon,
  SmartphoneIcon,
  SparklesIcon,
  TerminalSquareIcon,
  UsersIcon,
  UserRoundIcon,
  UsersRoundIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import type { CodeItLabSection } from "./panel";

/**
 * One icon per panel section, shared by the section nav so the tabs read as
 * places instead of words. The panel shell owns the rendering; this map only
 * answers "which mark belongs to this section".
 */
export const CODEITLAB_SECTION_ICONS: Record<CodeItLabSection["id"], LucideIcon> = {
  overview: CpuIcon,
  agents: SparklesIcon,
  setup: WrenchIcon,
  effects: SparklesIcon,
  nexus: NetworkIcon,
  memory: BrainIcon,
  models: LayersIcon,
  uncensored: ShieldIcon,
  rea: TerminalSquareIcon,
  ecosystem: BoxesIcon,
  remote: SmartphoneIcon,
  credentials: KeyRoundIcon,
  shorts: ClapperboardIcon,
  crew: UsersIcon,
  board: Columns3Icon,
  bots: BotIcon,
  mood: PaletteIcon,
  budget: WalletIcon,
  issues: BugIcon,
  wallpaper: ImageIcon,
  sketch: PencilIcon,
  marketplace: StoreIcon,
  engagements: HandshakeIcon,
  profile: UserRoundIcon,
  deploy: RocketIcon,
  team: UsersRoundIcon,
  search: SearchIcon,
};

export type SectionNavKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/**
 * Roving-tabindex math for the section nav. Returns the index that should take
 * focus (and tab stop) for a key, or null when the key is not a nav key. Wrap
 * around at both ends so the row behaves like a single control.
 */
export function nextSectionIndex(currentIndex: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (currentIndex + 1) % count;
  if (key === "ArrowLeft") return (currentIndex - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
