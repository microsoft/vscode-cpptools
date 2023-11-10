int i;

class Test
{
	auto AutoFunction1() -> double;
	auto AutoFunction2();
	decltype(i) AutoFunction3();
	decltype(auto) AutoFunction4();
	int *AutoFunction5();
};
