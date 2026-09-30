import { ProjectConfig } from "@/aiParams";
import { filterProjects, ProjectSearchOptions } from "@/utils/projectUtils";

describe("projectUtils", () => {
  const mockProjects: ProjectConfig[] = [
    {
      id: "1",
      name: "React Project",
      description: "A React-based frontend project",
      systemPrompt: "You are a helpful assistant.",
      projectModelKey: "gpt-3.5-turbo",
      modelConfigs: {
        temperature: 0.7,
        maxTokens: 6000,
      },
      contextSource: {
        inclusions: "src/**/*.tsx",
      },
      created: Date.now(),
      UsageTimestamps: Date.now(),
    },
    {
      id: "2",
      name: "Vue Dashboard",
      description: "A Vue.js dashboard application",
      systemPrompt: "You are a helpful assistant.",
      projectModelKey: "gpt-4",
      modelConfigs: {
        temperature: 0.5,
      },
      contextSource: {
        inclusions: "src/**/*.vue",
      },
      created: Date.now(),
      UsageTimestamps: Date.now(),
    },
    {
      id: "3",
      name: "API Service",
      description: undefined,
      systemPrompt: "You are a helpful assistant.",
      projectModelKey: "gpt-3.5-turbo",
      modelConfigs: {},
      contextSource: {
        inclusions: "src/**/*.ts",
      },
      created: Date.now(),
      UsageTimestamps: Date.now(),
    },
  ];

  describe("filterProjects()", () => {
    it("returns every project for an empty query", () => {
      const result = filterProjects(mockProjects, "");
      expect(result).toEqual(mockProjects);
      expect(result.length).toBe(3);
    });

    it("returns every project for a whitespace-only query", () => {
      const result = filterProjects(mockProjects, "   ");
      expect(result).toEqual(mockProjects);
      expect(result.length).toBe(3);
    });

    it("returns the projects whose name contains the query", () => {
      const result = filterProjects(mockProjects, "React");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("React Project");
    });

    it("returns the projects whose description contains the query", () => {
      const result = filterProjects(mockProjects, "Vue.js");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Vue Dashboard");
    });

    it("returns an empty array when no project matches", () => {
      const result = filterProjects(mockProjects, "NonExistentProject");
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("matches regardless of letter case by default", () => {
      const result = filterProjects(mockProjects, "react");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("React Project");
    });

    it("matches only the exact letter case when caseSensitive is set", () => {
      const options: ProjectSearchOptions = { caseSensitive: true };

      const result1 = filterProjects(mockProjects, "React", options);
      expect(result1.length).toBe(1);
      expect(result1[0].name).toBe("React Project");

      const result2 = filterProjects(mockProjects, "react", options);
      expect(result2.length).toBe(0);
    });

    it("ignores descriptions when searchInDescription is false", () => {
      const options: ProjectSearchOptions = {
        searchInName: true,
        searchInDescription: false,
      };

      const result1 = filterProjects(mockProjects, "Vue", options);
      expect(result1.length).toBe(1);
      expect(result1[0].name).toBe("Vue Dashboard");

      const result2 = filterProjects(mockProjects, "application", options);
      expect(result2.length).toBe(0);
    });

    it("ignores names when searchInName is false", () => {
      const options: ProjectSearchOptions = {
        searchInName: false,
        searchInDescription: true,
      };

      const result1 = filterProjects(mockProjects, "dashboard", options);
      expect(result1.length).toBe(1);
      expect(result1[0].name).toBe("Vue Dashboard");

      const result2 = filterProjects(mockProjects, "API", options);
      expect(result2.length).toBe(0);
    });

    it("matches a substring of a project name", () => {
      const result = filterProjects(mockProjects, "project");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("React Project");
    });

    it("still matches by name for a project without a description", () => {
      const result = filterProjects(mockProjects, "API");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("API Service");
    });

    it("returns an empty array for an empty project list", () => {
      const result = filterProjects([], "any query");
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("returns an empty array when the project list is null or undefined", () => {
      const result1 = filterProjects(null, "query");
      expect(result1).toEqual([]);

      const result2 = filterProjects(undefined, "query");
      expect(result2).toEqual([]);
    });

    it("matches queries containing punctuation literally", () => {
      const specialProject: ProjectConfig = {
        id: "special",
        name: "Test-Project_123",
        description: "Project with (special) chars!",
        systemPrompt: "You are a helpful assistant.",
        projectModelKey: "gpt-3.5-turbo",
        modelConfigs: {},
        contextSource: { inclusions: "*" },
        created: Date.now(),
        UsageTimestamps: Date.now(),
      };

      const testProjects = [...mockProjects, specialProject];

      const result1 = filterProjects(testProjects, "Test-Project");
      expect(result1.length).toBe(1);
      expect(result1[0].name).toBe("Test-Project_123");

      const result2 = filterProjects(testProjects, "(special)");
      expect(result2.length).toBe(1);
      expect(result2[0].name).toBe("Test-Project_123");
    });
  });
});
