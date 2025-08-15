SET PATH=%PATH%;%1
g++ -std=c++11 -pthread -g -O0 -o fib.exe main.cpp thread.cpp
