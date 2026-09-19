import type { Meta, StoryObj } from "@/lib/story";
import type { SearchCandidate } from "./types";
import { VaultSearchModalContent, type VaultSearchModalContentProps } from "./VaultSearchModal";

const RESULTS: SearchCandidate[] = [
  {
    path: "Books/Stoicism.epub",
    title: "How to Be a Stoic",
    folder: "Books/Philosophy",
    extension: "epub",
    snippet: "A field guide to applying Stoic philosophy in everyday life.",
    mtime: Date.UTC(2026, 8, 18),
    score: 0.91,
    source: "miyo",
  },
  {
    path: "Papers/Attention Is All You Need.pdf",
    title: "Attention Is All You Need",
    folder: "Papers",
    extension: "pdf",
    snippet: "The dominant sequence transduction models are based on complex recurrent…",
    mtime: Date.UTC(2026, 8, 17),
    score: 0.73,
    source: "miyo",
  },
  {
    path: "Notes/Stoicism reading list.md",
    title: "Stoicism reading list",
    folder: "Notes",
    extension: "md",
    snippet: "Filename match",
    mtime: Date.UTC(2026, 8, 16),
    score: null,
    source: "filename",
  },
];

const meta = {
  title: "Modals/Vault Search",
  component: VaultSearchModalContent,
  args: {
    query: "stoicism",
    onQueryChange: () => undefined,
    fileTypes: [
      { extension: "epub", count: 12, checked: true },
      { extension: "md", count: 4210, checked: true },
      { extension: "pdf", count: 312, checked: true },
    ],
    onTypeChange: () => undefined,
    results: RESULTS,
    searching: false,
    miyoUnavailable: false,
    onOpen: () => undefined,
    onClose: () => undefined,
    isMobile: false,
    canOpenInObsidian: (extension) => extension !== "epub",
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<VaultSearchModalContentProps>;
export default meta;

export const Results: StoryObj<VaultSearchModalContentProps> = {};

export const RecentlyOpened: StoryObj<VaultSearchModalContentProps> = {
  args: {
    query: "",
    results: RESULTS.map((result) => ({
      ...result,
      snippet: "Recently opened",
      score: null,
      source: "recent",
    })),
  },
};

export const MiyoUnavailable: StoryObj<VaultSearchModalContentProps> = {
  args: {
    miyoUnavailable: true,
    results: [RESULTS[2]],
  },
};

export const Empty: StoryObj<VaultSearchModalContentProps> = {
  args: { results: [] },
};
