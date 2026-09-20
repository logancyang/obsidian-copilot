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
      { id: "md", label: "md", extensions: ["md"], count: 4210, checked: true },
      { id: "pdf", label: "pdf", extensions: ["pdf"], count: 312, checked: true },
      { id: "epub", label: "epub", extensions: ["epub"], count: 12, checked: false },
      {
        id: "other",
        label: "Other",
        extensions: ["docx", "txt"],
        count: 9,
        checked: true,
      },
    ],
    onTypeChange: () => undefined,
    results: RESULTS,
    searching: false,
    miyoUnavailable: false,
    aiBoostEnabled: false,
    aiBoostLicensed: true,
    aiBoosting: false,
    aiBoostAttemptCompleted: false,
    aiBoostUnavailable: false,
    onAiBoostChange: () => undefined,
    onAiBoostNow: () => undefined,
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

export const LicenseRequired: StoryObj<VaultSearchModalContentProps> = {
  args: { aiBoostLicensed: false },
};

export const AiBoostDecisionDemo: StoryObj<VaultSearchModalContentProps> = {
  args: {
    query: "关于 Atlas 现在的最终决定",
    aiBoostEnabled: true,
    aiBoostAttemptCompleted: true,
    results: [
      {
        path: "Decisions/2025-04-22-atlas-final.md",
        title: "Atlas final decision — do not adopt",
        folder: "Decisions",
        extension: "md",
        snippet: "We decided against Atlas and superseded the January adoption decision.",
        mtime: Date.UTC(2025, 3, 22),
        score: 0.84,
        boostScore: 0.88,
        source: "miyo",
      },
      {
        path: "Decisions/2025-01-10-atlas-adopt.md",
        title: "Atlas adoption decision",
        folder: "Decisions",
        extension: "md",
        snippet: "The team agreed to adopt Atlas for the search migration.",
        mtime: Date.UTC(2025, 0, 10),
        score: 0.83,
        boostScore: 0.19,
        source: "miyo",
      },
      {
        path: "Research/atlas-comparison.md",
        title: "Atlas comparison notes",
        folder: "Research",
        extension: "md",
        snippet: "A topical comparison of Atlas with other search systems.",
        mtime: Date.UTC(2025, 2, 3),
        score: 0.8,
        boostScore: 0.08,
        source: "miyo",
      },
    ],
  },
};

export const AiBoostUnavailable: StoryObj<VaultSearchModalContentProps> = {
  args: {
    aiBoostEnabled: true,
    aiBoostAttemptCompleted: true,
    aiBoostUnavailable: true,
  },
};
