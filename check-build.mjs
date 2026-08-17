import fs from 'fs';
import path from 'path';

const distPath = 'D:\\projects\\PYSHORT - Copy\\dist';
const indexPath = path.join(distPath, 'index.html');

if (fs.existsSync(indexPath)) {
  console.log('Build output exists');
  const content = fs.readFileSync(indexPath, 'utf8');
  console.log('index.html length:', content.length);
  console.log('Contains root div:', content.includes('<div id="root">'));
  console.log('Contains script tag:', content.includes('<script'));
} else {
  console.log('Build output missing!');
}
