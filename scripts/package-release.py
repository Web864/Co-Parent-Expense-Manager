"""Package only reviewed source/config/documentation/build roots, never local data."""
from pathlib import Path
import sys
import zipfile
root=Path(__file__).resolve().parent.parent
output=root/'artifacts'/(sys.argv[1] if len(sys.argv)>1 else 'CoParent_Expense_Manager_Phase2_Production_Preparation.zip')
output.parent.mkdir(exist_ok=True)
files=[root/name for name in ['.env.example','.gitignore','index.html','package.json','package-lock.json','README.md','tailwind.config.js','tsconfig.json','vite.config.ts']]
for name in ['src','server','backend','public','scripts','tests','docs','dist','ops']:
    files.extend(p for p in (root/name).rglob('*') if p.is_file() and not p.is_symlink())
allowed={'.cjs','.js','.ts','.css','.svg','.sql','.md','.json','.html','.py','.ps1'}
files=sorted(set(p for p in files if p.is_file() and (p.suffix in allowed or p.name in {'.env.example','.gitignore'})))
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file,file.relative_to(root).as_posix())
with zipfile.ZipFile(output) as archive:
    names=archive.namelist()
    assert archive.testzip() is None
    assert '.env' not in names and '.env.example' in names
    assert not any(any(part in {'node_modules','artifacts','backups','.git','.codex','.agents'} for part in Path(name).parts) for name in names)
    assert not any(name.endswith(('.dump','.log','.zip','.png','.pdf')) for name in names)
print(f'Created {output.name}: {len(files)} files, {output.stat().st_size} bytes; exclusion and ZIP integrity checks passed.')
