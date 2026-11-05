#include <iostream>
#include <thread>
#include <chrono>
#include <cstdio>

// Platform-specific headers for thread naming only.
// Thread naming is preserved so named threads appear in the debugger's
// Threads / Call Stack view — a key feature of this debugging sample.
#if defined(__APPLE__)
#  include <pthread.h>
#elif defined(__linux__)
#  include <sys/prctl.h>
#endif

#include "thread.h"

// Set the name of the calling thread for debugger visibility.
// std::thread has no portable name API, so we use OS-specific calls.
static void set_thread_name(const char* name)
{
#if defined(__APPLE__)
    pthread_setname_np(name);           // macOS: sets the current thread's name
#elif defined(__linux__)
    prctl(PR_SET_NAME, name, 0, 0, 0); // Linux: sets the current thread's name
#else
    (void)name; // Silently ignored on unsupported platforms (e.g. Windows/MinGW)
#endif
}

static int fib(int n)
{
    switch (n) {
        case 0: return 1;
        case 1: return 1;
        default: return (fib(n-2) + fib(n-1));
    }
}

void thread_proc(int tid)
{
    char thread_name[16];
    snprintf(thread_name, sizeof(thread_name), "Thread %d", tid);
    set_thread_name(thread_name);

    std::chrono::milliseconds delay(500);

    for (int i = 0; i <= 30; i++) {
        std::cout << "Thread " << tid << ": fib(" << i << ") = " << fib(i) << std::endl;
        std::this_thread::sleep_for(delay);
    }

    std::cout << thread_name << " exited!" << std::endl;
}