import torch
import torch.nn as nn
import sys

# --- USER CONFIGURATION ---
# Replace this with the user's actual model class import
# from my_model import PPGModel 
class SimplePPGModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Conv1d(1, 16, 3)
        self.fc = nn.Linear(16 * 118, 2) # Example dimensions

    def forward(self, x):
        return self.fc(self.conv(x).view(x.size(0), -1))

def convert_pytorch(pth_path, onnx_path):
    print(f"Loading {pth_path}...")
    
    # 1. Load Model
    model = SimplePPGModel() 
    model.load_state_dict(torch.load(pth_path))
    model.eval()

    # 2. Define Input Shape (Crucial: Must match your App's expectaton!)
    # Batch Size=1, Channels=1, Signal Length=120
    dummy_input = torch.randn(1, 1, 120)

    # 3. Export
    print("Exporting to ONNX...")
    torch.onnx.export(
        model, 
        dummy_input, 
        onnx_path,
        input_names=['input_signal'],   # This matches your app's logs
        output_names=['sbp_dbp'],       # This matches your app's logs
        dynamic_axes={'input_signal': {0: 'batch_size'}, 'sbp_dbp': {0: 'batch_size'}}
    )
    print(f"✅ Success! Saved to {onnx_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python convert.py <input.pth> <output.onnx>")
    else:
        convert_pytorch(sys.argv[1], sys.argv[2])