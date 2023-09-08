// Comment block
// should
// get
// folded

/*
   Comment block
   should
   get
   folded
*/

#include "notfound1.h"
#include "notfound2.h"
#include "notfound3.h"

#define TEST

#ifdef TEST
void foo()
{
}
#endif

#ifndef TEST
void foo()
{
}
#endif

void bar()
{
#ifdef TEST
    foo();
#else
    foo();
#endif
}

class A
{
};

class B
{
    int i;
#ifdef TEST
    void foo2()
    {
    }
#else
    void foo2(int i)
    {
    }
#endif
};
