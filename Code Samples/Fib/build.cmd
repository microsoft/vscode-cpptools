@echo off
SET PATH=%PATH%;%1
g++ -g *.cpp --std=c++11 -O0 -o %2
