with open(r'D:\projects\PYSHORT - Copy\src\utils\ocr.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and remove the duplicate lines after fetchWithGeminiRotation in performGeminiOcrOnCanvas
for i, line in enumerate(lines):
    if 'const result = await fetchWithGeminiRotation(apiUrl, payload);' in line and i > 580 and i < 620:
        # Check if next two lines are the duplicates
        if i+1 < len(lines) and 'const jsonText = result.candidates' in lines[i+1]:
            if i+2 < len(lines) and 'const result = await response.json();' in lines[i+2]:
                if i+3 < len(lines) and 'const jsonText = result.candidates' in lines[i+3]:
                    # Remove the duplicate lines at i+2 and i+3
                    lines = lines[:i+2] + lines[i+4:]
                    print(f'Removed duplicate lines at {i+3} and {i+4}')
                    break

with open(r'D:\projects\PYSHORT - Copy\src\utils\ocr.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print('ocr.ts duplicate lines removed successfully')
