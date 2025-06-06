export interface TagData {
  id: string;
  name: string;
  color?: string;
}

export interface BaseItem {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Folder extends BaseItem {
  type: "folder";
}

export interface Note extends BaseItem {
  type: "note";
  title: string;
  contentPreview?: string;
  tags: string[]; // Array of tag IDs
}

export interface FileItem extends BaseItem {
  type: "file";
  extension: string;
}

export type Item = Folder | Note | FileItem;

export const mockTags: TagData[] = [
  { id: "t1", name: "work", color: "#3b82f6" },
  { id: "t2", name: "personal", color: "#10b981" },
  { id: "t3", name: "urgent", color: "#ef4444" },
  { id: "t4", name: "ideas", color: "#f97316" },
];

export const mockFolders: Folder[] = [
  {
    id: "f1",
    name: "Work Documents",
    parentId: null,
    type: "folder",
    createdAt: "2023-01-01T10:00:00Z",
    updatedAt: "2023-01-05T10:00:00Z",
  },
  {
    id: "f2",
    name: "Personal Projects",
    parentId: null,
    type: "folder",
    createdAt: "2023-01-02T11:00:00Z",
    updatedAt: "2023-01-03T11:00:00Z",
  },
  {
    id: "f3",
    name: "Q1 Reports",
    parentId: "f1",
    type: "folder",
    createdAt: "2023-01-10T10:00:00Z",
    updatedAt: "2023-01-11T10:00:00Z",
  },
  {
    id: "f4",
    name: "Meeting Notes",
    parentId: "f1",
    type: "folder",
    createdAt: "2023-01-12T14:00:00Z",
    updatedAt: "2023-01-12T15:00:00Z",
  },
];

export const mockNotes: Note[] = [
  {
    id: "n1",
    name: "Client Meeting Summary", // name for consistency, title is primary display
    title: "Client Meeting Summary",
    parentId: "f4",
    type: "note",
    contentPreview:
      "Discussed project milestones and upcoming deadlines. Key action items assigned.",
    tags: ["t1", "t3"],
    createdAt: "2023-01-12T16:00:00Z",
    updatedAt: "2023-01-12T16:30:00Z",
  },
  {
    id: "n2",
    name: "Brainstorming Session",
    title: "Brainstorming Session: New App",
    parentId: "f2",
    type: "note",
    contentPreview:
      "Initial ideas for the new mobile application. UI/UX considerations and feature list.",
    tags: ["t2", "t4"],
    createdAt: "2023-01-15T09:00:00Z",
    updatedAt: "2023-01-15T11:00:00Z",
  },
  {
    id: "n3",
    name: "Grocery List",
    title: "Grocery List",
    parentId: null, // Root note
    type: "note",
    contentPreview: "Milk, eggs, bread, cheese, apples.",
    tags: ["t2"],
    createdAt: "2023-01-16T18:00:00Z",
    updatedAt: "2023-01-16T18:05:00Z",
  },
];

export const mockFiles: FileItem[] = [
  {
    id: "file1",
    name: "Q1_Report_Final.pdf",
    parentId: "f3",
    type: "file",
    extension: ".pdf",
    createdAt: "2023-01-11T14:00:00Z",
    updatedAt: "2023-01-11T14:05:00Z",
  },
  {
    id: "file2",
    name: "CompanyLogo.png",
    parentId: "f1",
    type: "file",
    extension: ".png",
    createdAt: "2023-01-05T12:00:00Z",
    updatedAt: "2023-01-05T12:00:00Z",
  },
  {
    id: "file3",
    name: "project_brief.md",
    parentId: "f2",
    type: "file",
    extension: ".md",
    createdAt: "2023-01-03T15:00:00Z",
    updatedAt: "2023-01-04T10:00:00Z",
  },
  {
    id: "file4",
    name: "Website_mockup.jpg",
    parentId: null, // Root file
    type: "file",
    extension: ".jpg",
    createdAt: "2023-01-20T12:00:00Z",
    updatedAt: "2023-01-20T12:00:00Z",
  },
  {
    id: "file5",
    name: "script.excalidraw.md", // Example of a complex extension
    parentId: "f2",
    type: "file",
    extension: ".excalidraw.md",
    createdAt: "2023-01-21T10:00:00Z",
    updatedAt: "2023-01-21T10:00:00Z",
  },
];
