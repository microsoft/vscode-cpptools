#include "levelOneFile.h"

namespace test
{
    namespace extra
    {
        helper::helper(/* args */)
        {
            my_val_help = 2;
        }

        int helper::getHelp()
        {
            return my_val_help;
        }
    }
    document_symbol_tests::document_symbol_tests(/* args */)
    {
        val = 10 * h.getHelp();
    }
}

rootClass::rootClass()
{
    rootVal = 10;
}