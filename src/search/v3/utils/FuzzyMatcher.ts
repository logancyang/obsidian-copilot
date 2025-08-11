/**
 * Fuzzy matching utilities for improved search recall
 */
export class FuzzyMatcher {
  /**
   * Calculate Levenshtein distance between two strings
   */
  static levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] =
            1 +
            Math.min(
              dp[i - 1][j], // deletion
              dp[i][j - 1], // insertion
              dp[i - 1][j - 1] // substitution
            );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Calculate similarity score (0-1) based on Levenshtein distance
   */
  static similarity(str1: string, str2: string): number {
    const a = str1.toLowerCase();
    const b = str2.toLowerCase();
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;

    const distance = this.levenshteinDistance(a, b);
    return 1 - distance / maxLen;
  }

  /**
   * Generate fuzzy variants of a search term
   */
  static generateVariants(term: string): string[] {
    const variants = new Set<string>();
    const lower = term.toLowerCase();

    // Add original and various casings
    variants.add(term);
    variants.add(lower);
    variants.add(term.toUpperCase());

    // Add title case (first letter uppercase)
    if (lower.length > 0) {
      variants.add(lower[0].toUpperCase() + lower.slice(1));
    }

    // Add camelCase and PascalCase for multi-word terms
    if (lower.includes(" ") || lower.includes("-") || lower.includes("_")) {
      const words = lower.split(/[\s\-_]+/);
      // camelCase
      if (words.length > 1) {
        const camelCase =
          words[0] +
          words
            .slice(1)
            .map((w) => w[0]?.toUpperCase() + w.slice(1))
            .join("");
        variants.add(camelCase);
        // PascalCase
        const pascalCase = words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join("");
        variants.add(pascalCase);
      }
    }

    // Add common plurals/singulars
    if (lower.endsWith("s")) {
      variants.add(lower.slice(0, -1)); // Remove 's'
    } else if (lower.endsWith("es")) {
      variants.add(lower.slice(0, -2)); // Remove 'es'
    } else {
      variants.add(lower + "s"); // Add 's'
      if (lower.endsWith("y")) {
        variants.add(lower.slice(0, -1) + "ies"); // y -> ies
      }
    }

    // Add common typo corrections (adjacent key swaps)
    const keyboard: Record<string, string[]> = {
      a: ["s", "q", "w", "z"],
      b: ["v", "g", "h", "n"],
      c: ["x", "d", "f", "v"],
      d: ["s", "e", "r", "f", "c", "x"],
      e: ["w", "r", "d", "s"],
      f: ["d", "r", "t", "g", "v", "c"],
      g: ["f", "t", "y", "h", "b", "v"],
      h: ["g", "y", "u", "j", "n", "b"],
      i: ["u", "o", "k", "j"],
      j: ["h", "u", "i", "k", "m", "n"],
      k: ["j", "i", "o", "l", "m"],
      l: ["k", "o", "p"],
      m: ["n", "j", "k"],
      n: ["b", "h", "j", "m"],
      o: ["i", "p", "l", "k"],
      p: ["o", "l"],
      q: ["w", "a"],
      r: ["e", "t", "f", "d"],
      s: ["a", "w", "e", "d", "x", "z"],
      t: ["r", "y", "g", "f"],
      u: ["y", "i", "j", "h"],
      v: ["c", "f", "g", "b"],
      w: ["q", "e", "s", "a"],
      x: ["z", "s", "d", "c"],
      y: ["t", "u", "h", "g"],
      z: ["a", "s", "x"],
    };

    // Generate single character substitutions based on keyboard proximity
    for (let i = 0; i < lower.length && variants.size < 10; i++) {
      const char = lower[i];
      const neighbors = keyboard[char] || [];
      for (const neighbor of neighbors) {
        if (variants.size >= 10) break;
        const variant = lower.slice(0, i) + neighbor + lower.slice(i + 1);
        variants.add(variant);
      }
    }

    return Array.from(variants);
  }

  /**
   * Check if two terms are fuzzy matches
   */
  static isFuzzyMatch(term1: string, term2: string, threshold: number = 0.8): boolean {
    const raw = this.similarity(term1, term2);
    if (raw >= threshold) return true;

    // Secondary check with light plural/singular normalization improves recall for common forms
    const normalizePlural = (s: string): string => {
      const lower = s.toLowerCase();
      if (lower.endsWith("ies") && lower.length > 3) return lower.slice(0, -3) + "y";
      if (lower.endsWith("es") && lower.length > 2) return lower.slice(0, -2);
      if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 1)
        return lower.slice(0, -1);
      return lower;
    };
    const normA = normalizePlural(term1);
    const normB = normalizePlural(term2);
    if (normA === normB) return true; // treat exact normalized forms as match
    const normSim = this.similarity(normA, normB);
    return normSim >= threshold;
  }
}
