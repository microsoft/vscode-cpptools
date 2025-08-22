# Fibonacci Debugging Sample

This sample demonstrates C++ debugging capabilities in VS Code using a multithreaded Fibonacci number generator.

## Features
- Modern C++ implementation using `std::thread`
- Cross-platform debugging configuration
- Multiple debugging scenarios:
  - Breakpoint debugging
  - Conditional breakpoints
  - Watch expressions
  - Crash investigation
  - Debugger attachment

## Getting Started

### Prerequisites
- C++ compiler (g++/clang/MSVC)
- VS Code with C++ extension
- Debugger (gdb/lldb/MSVC debugger)

### Building
```bash
# Linux/macOS
make

# Windows (MinGW)
g++ -std=c++11 -pthread -o fib.exe main.cpp thread.cpp