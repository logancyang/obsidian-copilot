# TODO - Technical Debt & Future Improvements

This document tracks technical debt items and improvements that need to be addressed in the future.

## 1. Docs4LLM SSL Error in Projects Mode

### Issue Description

Document parsing for projects mode is failing with an SSL error (`net::ERR_SSL_BAD_RECORD_MAC_ALERT`) when trying to upload files to the docs4llm API endpoint.

### Technical Details

- **Error Location**: `src/LLMProviders/brevilabsClient.ts:185` in `makeFormDataRequest` method
- **Root Cause**: The method uses native `fetch` API instead of Obsidian's `requestUrl` API
- **Context**: While regular JSON requests were migrated to use `safeFetch` (which uses `requestUrl`) in commit e49aafa to fix CORS issues, the `makeFormDataRequest` method was not updated

### Why Current Approaches Won't Work

1. **Backend Constraint**: The `/docs4llm` endpoint only accepts multipart/form-data format with `files: List[UploadFile]`
2. **Obsidian Limitation**: The existing `safeFetch` function is hardcoded for `application/json` content type
3. **No JSON Alternative**: Unlike `pdf4llm` which accepts base64 JSON, there's no JSON endpoint for `docs4llm`

### Recommended Solution

Create a new `safeFetchFormData` function that:

1. Uses Obsidian's `requestUrl` API with proper multipart/form-data configuration
2. Handles FormData objects correctly
3. Bypasses CORS and SSL restrictions like `safeFetch` does for JSON

### Alternative Solutions

1. **Backend Modification**: Add a new `/docs4llm-base64` endpoint that accepts base64-encoded JSON payloads
2. **Research Obsidian API**: Investigate if newer versions of Obsidian's `requestUrl` support multipart/form-data
3. **SSL Certificate Fix**: Address the underlying SSL certificate issue (temporary workaround)

### Impact

- Users cannot parse non-markdown files (PDFs, Word docs, etc.) in projects mode
- This affects the core functionality of project context loading
- Workaround: Users must ensure their projects only contain markdown files

### References

- Related commit: e49aafa (Brevilabs CORS issue #918)
- Forum discussion: https://forum.obsidian.md/t/holo-how-to-add-a-png-image-or-file-to-formdata-in-obsidian-like-below-this-help/73420
- Backend implementation: `/Users/chaoyang/webapps/brevilabs-api/app/main.py:1039`

---

_Last updated: 2025-07-18_
