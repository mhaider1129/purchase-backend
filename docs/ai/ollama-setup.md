# WICI Supply Chain AI: Ollama setup

## Architecture and security boundary

The browser calls the authenticated Purchase Tracker backend. The backend invokes
the AI Intelligence module, whose allowlisted tool registry performs permission and
institute-scope checks before reading canonical domain data. Only compact structured
tool results are returned to the model. Ollama never receives database credentials,
SQL, shell access, filesystem access, or a direct browser connection.

```text
Browser --HTTPS--> Nginx --> Node backend --> http://127.0.0.1:11434 (Ollama)
```

Keep Ollama bound to localhost (or a controlled private network). Do **not** expose
port 11434 to the Internet, add a public Nginx proxy for it, or put its URL in React
environment variables.

## Ubuntu 24.04 installation

Run these commands manually after reviewing Ollama's installer for your environment:

```bash
curl -fsSL https://ollama.com/install.sh -o /tmp/install-ollama.sh
less /tmp/install-ollama.sh
sh /tmp/install-ollama.sh
sudo systemctl enable --now ollama
sudo systemctl status ollama --no-pager
```

The application does not install Ollama, modify firewall rules, or download models.

## Pull and test the initial model

```bash
ollama pull qwen3:4b
ollama list
curl --fail --silent http://127.0.0.1:11434/api/tags | python3 -m json.tool
curl --fail --silent http://127.0.0.1:11434/api/show \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3:4b"}' | python3 -m json.tool
```

The `/api/show` response must advertise `tools` in `capabilities`. If it does not,
choose an Ollama model/version that supports tool calling; the backend fails closed
instead of pretending a tool ran.

## Backend configuration

Add the following to `purchase-backend/.env` and restart only the Node backend:

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
AI_TIMEOUT_MS=60000
AI_MAX_TOOL_ITERATIONS=6
AI_MAX_TOOL_RESULT_BYTES=65536
```

`OPENAI_API_KEY` and `OPENAI_MODEL` are not required for Ollama. OpenAI remains an
optional provider selected with `AI_PROVIDER=openai`; its credentials are server-only.

Apply migrations 033 and 034 using the repository's reviewed manual-migration
process, then grant `ai-intelligence.use` only to intended users or roles.

## Audit failure policy

AI execution is **fail-closed** when its dedicated audit records cannot be
persisted. Failure to insert an interaction, insert a tool execution, or finish
an interaction produces a controlled `503 AI_AUDIT_UNAVAILABLE` response. The
failure is never swallowed and no successful AI response is returned without
its required audit record. If recording a terminal failure also fails, the
audit failure takes precedence because audit completeness cannot be asserted.

## Authenticated health check

```bash
export PURCHASE_TRACKER_TOKEN='replace-with-a-user-jwt'
curl --fail-with-body \
  -H "Authorization: Bearer ${PURCHASE_TRACKER_TOKEN}" \
  https://YOUR_PURCHASE_TRACKER_HOST/api/ai/health
```

An installed, tool-capable configured model returns `available`; an absent model,
unsupported model, or stopped Ollama returns HTTP 503 with `unavailable`. The response
never includes the base URL or a credential. Other Purchase Tracker modules continue
operating when AI is unavailable.

## Changing models and resource considerations

Change `OLLAMA_MODEL`, pull that exact model, and restart the backend. No business
logic change is needed. `qwen3:4b` is a configurable starting point, not a guarantee
of suitable performance. Model memory and disk requirements vary by quantization and
Ollama release. A small CPU-only Hetzner server may respond slowly or may need a
smaller tool-capable model. Check available RAM and disk before pulling:

```bash
free -h
df -h
```

No GPU or GPU-specific Node dependency is required.

## Troubleshooting

```bash
sudo systemctl status ollama --no-pager
sudo journalctl -u ollama -n 100 --no-pager
ollama list
curl --fail-with-body http://127.0.0.1:11434/api/tags
```

- `AI_SERVICE_UNAVAILABLE`: confirm the service is running and the model is installed.
- `AI_PROVIDER_TIMEOUT`: increase `AI_TIMEOUT_MS` within the supported 1–300 second range or use a smaller model.
- `AI_MODEL_TOOLS_UNSUPPORTED`: update Ollama or select a model whose `/api/show` capabilities include `tools`.
- `AI_PROVIDER_CONFIGURATION_ERROR`: verify provider name, URL, timeout, and iteration settings.
- `AI_TOOL_RESULT_TOO_LARGE`: narrow the requested filters instead of sending a large dataset to the model.