# Fine-tuning testgen-coder on your codebase

This directory contains everything needed to fine-tune the `qwen2.5-coder:3b` model on your React test generation patterns, then import it back into Ollama for 100% offline use.

## What's here

```
training/
  dataset.jsonl           # 58 (source → test) training pairs from expense-manager
  summary.json            # Metadata about each training pair
  finetune_colab.py       # Google Colab fine-tuning script
  import-to-ollama.sh     # Import GGUF back into Ollama
  README.md               # You are here
```

## Step-by-step guide

### Step 1: Open Google Colab

Go to [colab.research.google.com](https://colab.research.google.com) → New notebook.

Change runtime to GPU: **Runtime → Change runtime type → T4 GPU** (free tier).

### Step 2: Upload the dataset

Click the folder icon (left sidebar) → Upload → select `dataset.jsonl` from this directory.

### Step 3: Run the fine-tuning script

Copy each cell from `finetune_colab.py` into Colab cells and run them in order:

1. **Cell 1**: Install dependencies (~2 min)
2. **Cell 2**: Load model with 4-bit quantization (~1 min)
3. **Cell 3**: Load and format training data (~10 sec)
4. **Cell 4**: Configure training (~10 sec)
5. **Cell 5**: Train! (~30-60 min for 58 examples, 3 epochs)
6. **Cell 6**: Test the model with a sample component
7. **Cell 7**: Export to GGUF format (~5 min)

### Step 4: Download the GGUF file

After Cell 7 completes:
- In Colab's file browser, navigate to `testgen-coder-finetuned/`
- Right-click `unsloth.Q4_K_M.gguf` → Download
- File size: ~2GB

### Step 5: Import into Ollama

Place the downloaded `.gguf` file in this directory, then run:

```bash
bash packages/testgen/training/import-to-ollama.sh
```

Or manually:

```bash
cd packages/testgen/training
ollama create testgen-coder-finetuned -f Modelfile.finetuned
```

### Step 6: Use the fine-tuned model

```bash
# Set as the model for testgen
OLLAMA_MODEL=testgen-coder-finetuned npm run testgen:enhance

# Or for a single file
OLLAMA_MODEL=testgen-coder-finetuned npm run testgen:enhance:file -- src/components/MyComponent.tsx

# With verify mode (runs Jest, retries on failure)
OLLAMA_MODEL=testgen-coder-finetuned npm run testgen:enhance:smart
```

## Adding more training data

To improve the model with more examples:

1. Add well-written test files to the expense-manager (or any React project)
2. Re-run the dataset builder:
   ```bash
   node packages/testgen/scripts/build-training-data.mjs
   ```
3. Re-run the Colab fine-tuning with the updated `dataset.jsonl`

## Current training data stats

- **58 training examples** from expense-manager
- **58/65 tests pass** Jest verification (0 failures, 7 low coverage)
- Covers: components, contexts, hooks, services, utilities, pages, barrel files
- Average coverage: ~83%

## Requirements

- Google account (for free Colab GPU)
- Ollama installed locally
- No API keys or paid services needed
