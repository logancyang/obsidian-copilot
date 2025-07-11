import { ProjectConfig } from "@/aiParams";
import { filterProjects, ProjectSearchOptions } from "@/utils/projectUtils";

describe("projectUtils", () => {
  // Test data
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
      description: undefined, // Project without description
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

  describe("filterProjects", () => {
    test("should return all projects for empty query", () => {
      const result = filterProjects(mockProjects, "");
      expect(result).toEqual(mockProjects);
      expect(result.length).toBe(3);
    });

    test("should return all projects for whitespace query", () => {
      const result = filterProjects(mockProjects, "   ");
      expect(result).toEqual(mockProjects);
      expect(result.length).toBe(3);
    });

    test("should return matching projects when searching by project name", () => {
      const result = filterProjects(mockProjects, "React");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("React Project");
    });

    test("should return matching projects when searching by project description", () => {
      const result = filterProjects(mockProjects, "Vue.js");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Vue Dashboard");
    });

    test("should return empty array for non-matching query", () => {
      const result = filterProjects(mockProjects, "NonExistentProject");
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    test("should perform case-insensitive search by default", () => {
      const result = filterProjects(mockProjects, "react");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("React Project");
    });

    test("should perform case-sensitive search when configured", () => {
      const options: ProjectSearchOptions = { caseSensitive: true };

      // Correct case should find results
      const result1 = filterProjects(mockProjects, "React", options);
      expect(result1.length).toBe(1);
      expect(result1[0].name).toBe("React Project");

      // Wrong case should find no results
      const result2 = filterProjects(mockProjects, "react", options);
      expect(result2.length).toBe(0);
    });

    test("should search only in project names when configured", () => {
      const options: ProjectSearchOptions = {
        searchInName: true,
        searchInDescription: false,
      };

      // Can find in name
      const result1 = filterProjects(mockProjects, "Vue", options);
      expect(result1.length).toBe(1);
      expect(result1[0].name).toBe("Vue Dashboard");

      // Cannot find content only in description
      const result2 = filterProjects(mockProjects, "application", options);
      expect(result2.length).toBe(0);
    });

    test("should search only in project descriptions when configured", () => {
      const options: ProjectSearchOptions = {
        searchInName: false,
        searchInDescription: true,
      };

      // Can find in description
      const result1 = filterProjects(mockProjects, "dashboard", options);
      expect(result1.length).toBe(1);
      expect(result1[0].name).toBe("Vue Dashboard");

      // Cannot find content only in name
      const result2 = filterProjects(mockProjects, "API", options);
      expect(result2.length).toBe(0);
    });

    test("should handle partial matches", () => {
      const result = filterProjects(mockProjects, "project");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("React Project");
    });

    test("should handle projects without description", () => {
      const result = filterProjects(mockProjects, "API");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("API Service");
    });

    // Edge cases and error handling tests
    test("should handle empty project array", () => {
      const result = filterProjects([], "any query");
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    test("should handle null or undefined project array", () => {
      const result1 = filterProjects(null as any, "query");
      expect(result1).toEqual([]);

      const result2 = filterProjects(undefined as any, "query");
      expect(result2).toEqual([]);
    });

    test("should handle multiple projects matching same query", () => {
      const result = filterProjects(mockProjects, "project");
      expect(result.length).toBe(1); // Only "React Project" contains "project"
      expect(result[0].name).toBe("React Project");
    });

    test("should handle special characters and spaces", () => {
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

    test("should test complete combination of configuration options", () => {
      const options: ProjectSearchOptions = {
        caseSensitive: false,
        searchInName: true,
        searchInDescription: true,
      };

      const result = filterProjects(mockProjects, "vue", options);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Vue Dashboard");
    });
  });
});
