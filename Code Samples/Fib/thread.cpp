#include "thread.h"
#include <iostream>
#include <thread>
#include <chrono>
#include <atomic>
#include <string>
#include <random>
#include <pthread.h>

// Thread-safe counter for thread IDs
static std::atomic<int> g_tid{0};

// Generate fibonacci numbers recursively
static int fib(int n) {
    switch (n) {
        case 0: return 1;
        case 1: return 1;
        default: return fib(n - 1) + fib(n - 2);
    }
}

// Set thread name (platform-specific) with Linux truncation
static void set_thread_name(const std::string& name) {
#if defined(__APPLE__)
    pthread_setname_np(name.c_str());
#elif defined(__linux__)
    std::string n = name.substr(0, 15);  // limit ≤15 chars plus null (Linux limit) :contentReference[oaicite:0]{index=0}
    pthread_setname_np(pthread_self(), n.c_str());
#endif
}

// Thread-local RNG for good random delays
static thread_local std::mt19937_64 rng{std::random_device{}()};

// Uniform integer generator
static int intRand(int min, int max) {
    return std::uniform_int_distribution<int>(min, max)(rng);
}

void thread_proc() {
    int tid = g_tid.fetch_add(1, std::memory_order_relaxed);
    std::string thread_name = "Thread " + std::to_string(tid);
    set_thread_name(thread_name);

    auto delay = std::chrono::nanoseconds(500000000 + intRand(0, 500000000));

    std::this_thread::sleep_for(delay);
    for (int i = 0; i <= 30; ++i) {
        std::cout << thread_name << ": fib(" << i << ") = " << fib(i) << "\n";
        std::this_thread::sleep_for(delay);
    }

    std::cout << thread_name << " exited!\n";
}
