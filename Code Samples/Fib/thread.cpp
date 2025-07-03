#include <iostream>
#include <thread>
#include <chrono>
#include <atomic>
#include <string>
#include <random>
#include <mutex>

// Thread-safe counter for thread IDs
static std::atomic<int> g_tid{0};

// Mutex for thread-safe console output
static std::mutex cout_mutex;

// Generate fibonacci numbers recursively (memoization would be better)
static int fib(int n) {
    if (n <= 1) return 1;
    return fib(n - 1) + fib(n - 2);
}

// Cross-platform thread naming (C++20 would use std::jthread)
static void set_thread_name(const std::string& name) {
#ifdef __cpp_lib_jthread
    // Future C++20 implementation
    // std::jthread::set_name(name);
#else
    // Current placeholder
#endif
}

// Thread-local RNG for random delays
static thread_local std::mt19937_64 rng{std::random_device{}()};

// Uniform integer generator
static int intRand(int min, int max) {
    return std::uniform_int_distribution<int>(min, max)(rng);
}

void thread_proc() {
    const int tid = g_tid.fetch_add(1, std::memory_order_relaxed);
    const std::string thread_name = "Thread " + std::to_string(tid);
    set_thread_name(thread_name);

    const auto delay = std::chrono::nanoseconds(500000000 + intRand(0, 500000000));

    std::this_thread::sleep_for(delay);
    
    for (int i = 0; i <= 30; ++i) {
        {
            std::lock_guard<std::mutex> lock(cout_mutex);
            std::cout << thread_name << ": fib(" << i << ") = " << fib(i) << std::endl;
        }
        std::this_thread::sleep_for(delay);
    }

    {
        std::lock_guard<std::mutex> lock(cout_mutex);
        std::cout << thread_name << " exited!" << std::endl;
    }
}

