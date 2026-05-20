# Fib

This code sample is to show debugging. Update `launch.json` and `tasks.json` in the `.vscode` folder to use your setup to build and debug.

## Building

Use one of the commands below to build the sample. The Makefile was removed and the sample is built with g++ directly.

```bash
# Linux / macOS
g++ -g *.cpp -std=c++11 -o fib.out

# Windows (MinGW)
g++ -g *.cpp -std=c++11 -o fib.exe
```

On Windows you can also run the included `build.cmd` if you prefer (it expects the path to a MinGW/Cygwin `bin` folder and an output name):

```powershell
.\build.cmd <Path\To\MinGW\Bin> fib.exe
```

After building, use the `launch.json` in this folder (or your own) to debug the produced binary.
```markdown
# Fib

This code sample is to show debugging. Update `launch.json` and `tasks.json` in the `.vscode` folder to use your setup to build and debug.

## Building

Use one of the commands below to build the sample. The Makefile was removed and the sample is built with g++ directly.

```bash
# Linux / macOS
g++ -g *.cpp -std=c++11 -o fib.out

# Windows (MinGW)
g++ -g *.cpp -std=c++11 -o fib.exe
```

On Windows you can also run the included `build.cmd` if you prefer (it expects the path to a MinGW/Cygwin `bin` folder and an output name):

```powershell
.\build.cmd <Path\To\MinGW\Bin> fib.exe
```

After building, use the `launch.json` in this folder (or your own) to debug the produced binary.
```
# Fib

This code sample is to show debugging. Update `launch.json` and `tasks.json` in the `.vscode` folder to use your setup to build and debug.