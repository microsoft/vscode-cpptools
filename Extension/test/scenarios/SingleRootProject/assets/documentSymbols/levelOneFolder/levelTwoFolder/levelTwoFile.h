namespace NS
{
       class F
       {
             void f();
             void g();
             void l();
       };
}

void h()
{
}

namespace NS
{
       void F::f()
       {
       }
       void F::g()
       {
       }
}

using namespace NS;

void F::l()
{
}
