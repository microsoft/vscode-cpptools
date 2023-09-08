#include "call_test1.h"

namespace call_namespace
{
    void local_call_one()
    {
    }

    void local_call_two()
    {
        local_call_one();
    }
}

void function_caller()
{
    call_namespace::local_call_two();

    call_test1 c;
    c.call_function_one(1);
    c.call_function_two(true);
}

void top_caller()
{
    function_caller();
}