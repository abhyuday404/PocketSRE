# Optional API models

Local models and deterministic triage remain the default. To opt into cloud inference,
open **Settings → AI model → Use an API key**, select a provider, enter its model ID
and your own API key, then select **Save and use API model**. This selection applies
to incident analysis, repository answers and patch drafting, and temporary chat.
No additional PocketSRE server configuration is required for inference. Repository
collection and publishing continue through the existing gateway and approval boundary.

| Provider option   | API adapter          | Model field                                         |
| ----------------- | -------------------- | --------------------------------------------------- |
| OpenAI            | Responses API        | Exact text-model ID available to your API account   |
| Anthropic         | Messages API         | Exact Claude model ID available to your API account |
| Google Gemini     | Generate Content API | Gemini text-model ID                                |
| OpenRouter        | Chat Completions API | Model ID including its provider prefix              |
| OpenAI-compatible | Chat Completions API | Model ID from that service                          |

The custom option also requires the HTTPS API base URL, including any version path
(for example, `/v1`). It supports bearer-key Chat Completions services, not every API:
providers requiring different authentication, Azure deployment URLs, AWS signing,
or additional request formats need another adapter. A key's format does not reliably
identify its provider or select a model, so both choices are explicit. Model IDs are
editable rather than tied to a hardcoded catalog that becomes outdated.

Keys and profiles are saved through Expo Secure Store with device-only access.
Each provider retains its own profile; there is one configurable custom endpoint.
Saved keys are never shown in Settings. Leave the key field blank to reuse the same
provider/endpoint key. Changing a custom endpoint requires entering a key again.
Removing the active key switches to local mode. Switching to **On-device models →
Switch to on-device** retains API profiles and the previously selected GGUF model.

Saving sends no network request. **Test saved API model** explicitly sends a small
“Reply with OK” request to the selected model, without repository or incident data.
It can incur provider charges and tests text generation, not incident reasoning or
structured-output quality. Model availability, API permissions and billing are
controlled by the provider. Subscription access to a consumer chat app does not
by itself configure an API key in PocketSRE.

## Data and behavior

- In cloud mode, prompts, relevant incident evidence, selected source files, and chat
  history go directly from the phone to the chosen provider over HTTPS. Its retention
  policies and charges apply. OpenRouter may route content to another model provider.
- The shared evidence sanitization and text redaction run before transmission. They
  reduce accidental credential disclosure but do not make private source code public
  or guarantee detection of every secret. API credentials are attached only as request
  headers; they are not included in prompts, logs, exports, or gateway requests.
- Requests reject redirects, bound input and response sizes, time out after two minutes,
  and are not automatically retried. Temporary chat supports cancellation. Cloud chat
  currently displays the completed response; on-device chat retains token streaming.
- OpenAI requests use `store: false`; this is not a promise of zero provider retention.
- Diagnosis and patch output pass the same shared validation as local models. Cloud
  diagnoses are labelled `cloud-llm` in saved snapshots and **Cloud API** in the UI.
  Failed or invalid cloud diagnosis falls back to labelled local rules. Patch drafting
  and chat report errors instead of fabricating fallback answers or patches.
- Settings and model changes reset the agent conversation. Cloud inference cannot
  publish changes by itself: existing review, approval and execution checks still apply.

Provider formats are covered by mocked HTTP tests. Live API access, native transport,
and model quality need verification on the target phone with user-provided keys.

## API references

- [OpenAI text generation](https://developers.openai.com/api/docs/guides/text)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)
- [Gemini Generate Content](https://ai.google.dev/api/generate-content)
- [OpenRouter API](https://openrouter.ai/docs/api_reference/overview)
