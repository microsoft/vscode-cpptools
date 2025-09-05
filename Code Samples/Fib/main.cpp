#include <iostream>
#include <thread>
#include <vector>
#include <cstdlib>
#include <ctime>
#include <cstring>
#include <atomic>
#include <chrono>
#include <csignal>
#include <unistd.h>  

#include "thread.h"

#define THREAD_COUNT 10

static constexpr char block[] = "--block";
static constexpr char crash[] = "--crash";
static constexpr char test_flag[] = "--test";
std::atomic<int> test_count{0};  // Thread-safe counter
volatile std::sig_atomic_t g_signal_status = 0;

void signal_handler(int signal) {
    g_signal_status = signal;
}

int main(int argc, char **argv)
{
    std::signal(SIGINT, signal_handler);

    std::srand(static_cast<unsigned>(std::time(nullptr)));

    std::cout << "Hello World!" << std::endl;

    if (argc == 2) {
        if (std::strcmp(block, argv[1]) == 0) {
            std::cout << "Attach a debugger and set foo=0 to continue" << std::endl;
            std::cout << "Process ID: " << getpid() << std::endl;

            volatile int foo = 1;
            while (foo && g_signal_status == 0) {
                std::this_thread::sleep_for(std::chrono::seconds(1));
                std::cout << "Waiting... (press Ctrl-C to quit)" << std::endl;
            }
            return 0;
        }
        else if (std::strcmp(crash, argv[1]) == 0) {
            std::cout << "Triggering intentional crash..." << std::endl;
            volatile int foo = 0;
            volatile int bar = 1 / foo;  
            (void)bar;                   
            return 1;                     
        }
        else if (std::strcmp(test_flag, argv[1]) == 0) {
            std::cout << "Running in test mode" << std::endl;
        }
    }

    std::vector<std::thread> threads;
    threads.reserve(THREAD_COUNT);

    try {
        for (int i = 0; i < THREAD_COUNT; ++i) {
            std::cout << "Launching thread " << i << std::endl;
            threads.emplace_back(thread_proc);
        }

        for (auto& t : threads) {
            if (t.joinable()) {
                t.join();
                test_count.fetch_add(1, std::memory_order_relaxed);
            }
        }
    }
    catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        for (auto& t : threads) {
            if (t.joinable()) {
                t.detach();
            }
        }
        return 1;
    }

    std::cout << "\nAll " << test_count.load() << " threads completed successfully!" << std::endl;
    return 0;
}