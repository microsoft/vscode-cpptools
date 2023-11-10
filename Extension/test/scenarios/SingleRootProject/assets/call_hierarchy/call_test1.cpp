#include "call_test1.h"

void call_test1::call_function_one(int x)
{
    call_cleanup();
}

int call_test1::call_function_two(bool a)
{
    call_cleanup();
    return 0;
}

void call_test1::call_cleanup()
{
}