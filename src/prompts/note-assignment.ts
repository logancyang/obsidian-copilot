/**
 * Note Assignment Query Generation Prompt
 *
 * Used to generate optimized search queries from project context
 * for finding relevant notes in the vault.
 */

/**
 * System prompt for generating search queries from project context
 */
export const NOTE_ASSIGNMENT_QUERY_PROMPT = `You are an expert at generating search queries for finding relevant notes in a personal knowledge base.

Given a project, generate a single optimized search query that will find notes relevant to this project.

## Project Details
Title: {title}
Description: {description}
Success Criteria: {successCriteria}

## Instructions
1. Extract the key concepts, topics, and themes from the project
2. Include domain-specific terminology that would appear in relevant notes
3. Include synonyms and related concepts for better recall
4. Keep the query concise but comprehensive (10-20 words)
5. Focus on NOUNS and CONCEPTS, not action words
6. Do NOT include the project title verbatim - extract its essence

## Output Format
Return ONLY the search query, nothing else. No quotes, no explanation.

## Examples
Project: "Master React Hooks"
Query: react hooks useState useEffect custom hooks state management components functional

Project: "Write PhD Thesis on Machine Learning in Healthcare"
Query: machine learning healthcare medical diagnosis neural networks patient data clinical research

Project: "Launch Personal Blog"
Query: blog writing content creation publishing website posts articles audience

Project: "Learn Piano"
Query: piano music keyboard practice scales chords songs lessons technique

Project: "Improve Public Speaking"
Query: public speaking presentation communication audience confidence speech rhetoric`;

/**
 * Build the query generation prompt with project context
 */
export function buildQueryGenerationPrompt(
  title: string,
  description: string,
  successCriteria: string[]
): string {
  return NOTE_ASSIGNMENT_QUERY_PROMPT.replace("{title}", title)
    .replace("{description}", description)
    .replace("{successCriteria}", successCriteria.join("; ") || "Not specified");
}
