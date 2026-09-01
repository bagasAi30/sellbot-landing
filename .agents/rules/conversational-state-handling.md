# Conversational State Handling

When building or modifying conversational state machines, intent detectors, or fallback logic (especially in `index.js` or `ai.js`):
1. **Comprehensive Cancellation Catchers**: Always include negative/cancellation keywords (`batal`, `cancel`, `nggak jadi`, `ga jadi`, `stop`) in any arrays or regexes designed to catch "short replies" or "bail outs" from a current conversational flow.
2. **Prevent API Misrouting**: Never route raw user input to external APIs (like shipping/location search) without first checking if the input is a command to cancel the current action.
