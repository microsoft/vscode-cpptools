#include <iostream>
#include <thread>
#include <atomic>
#include <string>
#include <cstring>

#include "thread.h"

#define THREAD_COUNT 10

static char block[] = "--block";
std::atomic<int> test(0);

int main(int argc, char **argv)
{
    static char pidText[] = "PID: ";
    std::string helpText = "Attach a debugger and execute 'set foo=0' to continue";
    char helloText[] = "Hello World!";

    std::cout << helloText << std::endl;

    std::thread threads[THREAD_COUNT];

    if (argc == 2 && !strcmp(block, argv[1]))
    {
        std::cout << helpText << std::endl;
        volatile int foo = 1;
        while (foo)
            ;
    }

    if (argc == 2 && !strcmp("--crash", argv[1]))
    {
        int foo = 0;
        int bar = 1 / foo;
    }

    for (int i = 0; i < THREAD_COUNT; i++)
    {
        std::cout << "Test " << i << std::endl;
        threads[i] = std::thread(thread_proc, i);
    }

    for (int i = 0; i < THREAD_COUNT; i++)
    {
        threads[i].join();
        test++;
    }

    std::cout << "All threads exited!" << std::endl;

    return 0;
}
