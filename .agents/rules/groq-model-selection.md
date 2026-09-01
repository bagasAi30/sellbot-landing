# Groq Model Selection

When debugging, modifying, or testing AI functionality for the Sellbot backend (`ai.js` or similar files interacting with the Groq API) in this workspace:
1. **Never assume standard Groq models** (like `llama3-8b-8192` or `llama-3.1-8b-instant`) are available, as they will return a 404 error.
2. **Check available models** by running `node backend-bot/test-groq-models.js` if you are unsure.
3. **Prefer High-Capacity Models**: Always use `openai/gpt-oss-120b` (or the highest parameter model available in the test script output) for chat completions. Smaller models (like Qwen 3.8-27b) struggle with the dense context injection in this application and will hallucinate or ignore instructions.
