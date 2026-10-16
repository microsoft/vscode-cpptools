# Fib

This code sample demonstrates multithreaded debugging with C++11. It spawns 10 named threads, each computing Fibonacci numbers, and is designed to show how VS Code with the C/C++ extension can display named threads in the Threads and Call Stack views.

## Building

Use one of the commands below to build the sample.

```bash
# Linux / macOS
g++ -g *.cpp -std=c++11 -o fib.out

# Windows (MinGW)
g++ -g *.cpp -std=c++11 -o fib.exe
```

On Windows you can also run the included `build.cmd` (it expects the path to a MinGW `bin` folder and an output name):

```powershell
.\build.cmd <Path\To\MinGW\Bin> fib.exe
```

## Debugging

Update `launch.json` in the `.vscode` folder to point to your debugger if needed (e.g. set `miDebuggerPath` on Windows).

Press **F5** to build and launch the debugger. The build task compiles the sample automatically before starting the debug session.

## Notes

- Thread naming uses `pthread_setname_np` on macOS/Linux so threads appear by name in the debugger's Threads / Call Stack view. On Windows the names are visible via the thread IDs.
- No `-lpthread` flag is needed: the sample uses `std::thread` for threading and only calls the native thread-naming API for debugger visibility.