#include <iostream>
#include <unistd.h>
#include <sys/types.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <string.h>

#include "thread.h"

#define THREAD_COUNT 10

static char block[] = "--block";
int test = 0;

int main(int argc, char **argv)
{
    srand(time(NULL));

    static char pidText[] = "PID: ";
    std::string helpText = "Attach a debugger and execute 'set foo=0' to continue";
    char helloText[] = "Hello World!";

    std::cout << helloText << std::endl;

    pthread_t threads[THREAD_COUNT];

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
        pthread_create(&threads[i], NULL, &thread_proc, NULL);
    }

    for (int i = 0; i < THREAD_COUNT; i++)
    {
        pthread_join(threads[i], NULL);
        test++;
    }

    std::cout << "All threads exited!" << std::endl;

    return 1;
}
