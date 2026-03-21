#!/bin/bash
# Import a fine-tuned GGUF model into Ollama.
#
# Usage:
#   1. Download unsloth.Q4_K_M.gguf from Google Colab
#   2. Place it in this directory (packages/testgen/training/)
#   3. Run: bash import-to-ollama.sh
#
# The script creates a Modelfile and imports the model as "testgen-coder-finetuned"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GGUF_FILE="$SCRIPT_DIR/unsloth.Q4_K_M.gguf"

if [ ! -f "$GGUF_FILE" ]; then
  echo "ERROR: GGUF file not found at: $GGUF_FILE"
  echo ""
  echo "Download it from Google Colab first:"
  echo "  1. Open Colab file browser (folder icon)"
  echo "  2. Navigate to testgen-coder-finetuned/"
  echo "  3. Right-click unsloth.Q4_K_M.gguf → Download"
  echo "  4. Place it in: $SCRIPT_DIR/"
  exit 1
fi

echo "Creating Modelfile for fine-tuned model..."

cat > "$SCRIPT_DIR/Modelfile.finetuned" << 'MODELEOF'
FROM ./unsloth.Q4_K_M.gguf

SYSTEM """You are a React testing expert. Given a React/TypeScript source file, generate comprehensive Jest + React Testing Library test files.

Rules:
- Use Jest 29 + @testing-library/react 16 + @testing-library/user-event 14
- Use renderWithProviders for components needing context providers
- Use accessible queries: getByRole, getByLabelText, getByText
- Test behavior, not implementation
- Include edge cases, error states, and interaction tests
- Output ONLY new it() blocks when enhancing existing tests"""

PARAMETER temperature 0.2
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
PARAMETER num_predict 1024
MODELEOF

echo "Importing into Ollama as 'testgen-coder-finetuned'..."
cd "$SCRIPT_DIR"
ollama create testgen-coder-finetuned -f Modelfile.finetuned

echo ""
echo "Done! Use it with:"
echo "  OLLAMA_MODEL=testgen-coder-finetuned npm run testgen:enhance"
echo ""
echo "Or set it as default:"
echo "  export OLLAMA_MODEL=testgen-coder-finetuned"
