"""
Fine-tune qwen2.5-coder:3b on your React test generation dataset.

Run this in Google Colab (free T4 GPU):
  1. Upload dataset.jsonl to Colab
  2. Run all cells
  3. Download the exported GGUF file
  4. Import into Ollama on your local machine

Requires: Free Google Colab account (colab.research.google.com)
GPU: T4 (15GB VRAM) — free tier is sufficient for 3B model
Time: ~30-60 minutes for 58 examples, 3 epochs
"""

# ============================================================================
# Cell 1: Install dependencies
# ============================================================================

# !pip install -q "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
# !pip install -q --no-deps "trl<0.9.0" peft accelerate bitsandbytes

# ============================================================================
# Cell 2: Load model with Unsloth (4-bit quantization for T4)
# ============================================================================

from unsloth import FastLanguageModel
import torch
import json

MODEL_NAME = "unsloth/Qwen2.5-Coder-3B-Instruct-bnb-4bit"
MAX_SEQ_LENGTH = 4096
LORA_RANK = 16

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=MAX_SEQ_LENGTH,
    dtype=None,  # auto-detect
    load_in_4bit=True,
)

# Add LoRA adapters (only trains ~1-2% of parameters)
model = FastLanguageModel.get_peft_model(
    model,
    r=LORA_RANK,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_alpha=LORA_RANK,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
)

print(f"Trainable parameters: {model.print_trainable_parameters()}")

# ============================================================================
# Cell 3: Load and format training data
# ============================================================================

def load_dataset_jsonl(path):
    """Load the JSONL dataset produced by build-training-data.mjs"""
    examples = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            examples.append(data)
    return examples

# Upload dataset.jsonl to Colab first, then:
DATASET_PATH = "dataset.jsonl"
raw_data = load_dataset_jsonl(DATASET_PATH)
print(f"Loaded {len(raw_data)} training examples")

# Format for Qwen chat template
def format_for_training(example):
    """Convert our JSONL format to Qwen2.5 chat format"""
    messages = example["messages"]
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
    )
    return {"text": text}

from datasets import Dataset

dataset = Dataset.from_list([format_for_training(ex) for ex in raw_data])
print(f"Dataset ready: {len(dataset)} examples")
print(f"Sample (first 200 chars): {dataset[0]['text'][:200]}")

# ============================================================================
# Cell 4: Training configuration
# ============================================================================

from trl import SFTTrainer
from transformers import TrainingArguments

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=MAX_SEQ_LENGTH,
    dataset_num_proc=2,
    packing=False,
    args=TrainingArguments(
        # Training hyperparameters
        num_train_epochs=3,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        warmup_steps=5,
        lr_scheduler_type="linear",

        # Precision & optimization
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        optim="adamw_8bit",

        # Logging
        logging_steps=1,
        output_dir="outputs",
        save_strategy="epoch",
        seed=42,

        # Memory optimization for T4
        gradient_checkpointing=True,
    ),
)

# ============================================================================
# Cell 5: Train!
# ============================================================================

print("Starting fine-tuning...")
trainer_stats = trainer.train()
print(f"\nTraining complete!")
print(f"  Loss: {trainer_stats.training_loss:.4f}")
print(f"  Runtime: {trainer_stats.metrics['train_runtime']:.0f}s")
print(f"  Samples/sec: {trainer_stats.metrics['train_samples_per_second']:.2f}")

# ============================================================================
# Cell 6: Test the fine-tuned model
# ============================================================================

FastLanguageModel.for_inference(model)

test_prompt = """Generate a test file for this React component:

## File: components/common/Button.tsx
```tsx
import React from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export const Button: React.FC<ButtonProps> = ({ label, onClick, disabled, variant = 'primary' }) => {
  return (
    <button className={`btn btn-${variant}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
};
```"""

messages = [
    {"role": "system", "content": "You are a React testing expert. Generate comprehensive Jest + RTL tests."},
    {"role": "user", "content": test_prompt},
]

inputs = tokenizer.apply_chat_template(
    messages,
    tokenize=True,
    add_generation_prompt=True,
    return_tensors="pt",
).to("cuda")

outputs = model.generate(
    input_ids=inputs,
    max_new_tokens=1024,
    temperature=0.2,
    top_p=0.9,
)

response = tokenizer.decode(outputs[0][inputs.shape[1]:], skip_special_tokens=True)
print("Generated test:\n")
print(response)

# ============================================================================
# Cell 7: Export to GGUF (for Ollama)
# ============================================================================

# Save as GGUF Q4_K_M (good quality/size balance)
print("Exporting to GGUF format...")
model.save_pretrained_gguf(
    "testgen-coder-finetuned",
    tokenizer,
    quantization_method="q4_k_m",
)
print("GGUF export complete: testgen-coder-finetuned/")

# Download the file from Colab:
#   - Find testgen-coder-finetuned/unsloth.Q4_K_M.gguf in the file browser
#   - Right-click → Download
#   - Or use: from google.colab import files; files.download("testgen-coder-finetuned/unsloth.Q4_K_M.gguf")

print("\n" + "=" * 60)
print("NEXT STEPS:")
print("=" * 60)
print("1. Download the .gguf file from Colab")
print("2. On your local machine, create a Modelfile:")
print('   FROM ./unsloth.Q4_K_M.gguf')
print("3. Import into Ollama:")
print("   ollama create testgen-coder-finetuned -f Modelfile")
print("4. Use it:")
print("   OLLAMA_MODEL=testgen-coder-finetuned npm run testgen:enhance")
