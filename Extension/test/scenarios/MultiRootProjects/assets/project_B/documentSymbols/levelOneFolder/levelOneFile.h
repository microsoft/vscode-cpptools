namespace test
{
    namespace extra
    {
        class helper
        {
        private:
            int my_val_help;
        public:
            helper(/* args */);
            int getHelp();
        };
    }

    class document_symbol_tests
    {
    private:
        int val;
        extra::helper h;
    public:
        document_symbol_tests(/* args */);
        ~document_symbol_tests();
    };
}

class rootClass
{
    private:
    int rootVal;
    public:
    rootClass();
};