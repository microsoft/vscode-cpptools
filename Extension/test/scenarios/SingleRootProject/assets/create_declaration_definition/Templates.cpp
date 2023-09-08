
template<typename One, typename Two> struct S {};

template<typename One>
struct S<One, int>
{
	template <typename Type>
	void OneTemplateFunction()
	{
	}
};

template<>
struct S<int, int>
{
	void ZeroTemplateFunction()
	{
	}
};