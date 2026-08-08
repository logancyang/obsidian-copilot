# Vendor Guide

Provider-specific quirks and configuration that don't generalize across LLM
vendors. Read the relevant section when wiring up or debugging a specific
provider.

## AWS Bedrock

**IMPORTANT**: When using AWS Bedrock, always use **cross-region inference profile IDs** for better reliability and availability:

- **Global** (recommended): `global.anthropic.claude-sonnet-4-5-20250929-v1:0`
  - Routes to any commercial AWS region automatically
  - Best for reliability and performance
- **US**: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
- **EU**: `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`
- **APAC**: `apac.anthropic.claude-sonnet-4-5-20250929-v1:0`

❌ **Avoid regional model IDs** (without prefix): `anthropic.claude-sonnet-4-5-20250929-v1:0`

- These only work in specific regions and often fail
- Not recommended for production use

**References:**

- [AWS Bedrock Cross-Region Inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)
- [Supported Inference Profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)
