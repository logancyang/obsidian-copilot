import {
  EMBEDDING_MODEL_IDENTITY_PREFIX,
  getEmbeddingModelIdentity,
  getValidEmbeddingDimensions,
} from "./embeddingDimensions";

describe("getValidEmbeddingDimensions", () => {
  it.each([512, 1024])("accepts the positive integer %d", (dimensions) => {
    expect(getValidEmbeddingDimensions(dimensions)).toBe(dimensions);
  });

  it.each([
    undefined,
    "",
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "512",
  ])("rejects an invalid dimensions value: %p", (dimensions) => {
    expect(getValidEmbeddingDimensions(dimensions)).toBeUndefined();
  });
});

describe("getEmbeddingModelIdentity", () => {
  it("keeps the legacy model name when dimensions are not configured", () => {
    expect(getEmbeddingModelIdentity("text-embedding-3-small", undefined)).toBe(
      "text-embedding-3-small"
    );
  });

  it("includes valid dimensions in a stable internal identity", () => {
    const identity = getEmbeddingModelIdentity("text-embedding-3-small", 512);

    expect(identity).toBe(
      `${EMBEDDING_MODEL_IDENTITY_PREFIX}${encodeURIComponent("text-embedding-3-small")}|dimensions=512`
    );
    expect(getEmbeddingModelIdentity("text-embedding-3-small", 512)).toBe(identity);
  });

  it("uses different identities for different valid dimensions", () => {
    expect(getEmbeddingModelIdentity("text-embedding-3-small", 512)).not.toBe(
      getEmbeddingModelIdentity("text-embedding-3-small", 1024)
    );
  });

  it("encodes model names containing the dimensions delimiter into distinct configured identities", () => {
    const firstModelName = "test|dimensions=512";
    const secondModelName = "test|dimensions=1024";
    const firstIdentity = getEmbeddingModelIdentity(firstModelName, 512);
    const secondIdentity = getEmbeddingModelIdentity(secondModelName, 512);

    expect(firstIdentity).toBe(
      `${EMBEDDING_MODEL_IDENTITY_PREFIX}test%7Cdimensions%3D512|dimensions=512`
    );
    expect(firstIdentity).not.toBe(secondIdentity);
  });
});
