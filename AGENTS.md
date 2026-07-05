## 通用语言要求
- 函数名、变量名等代码内容，统一使用英文
- 文档、注释、日志、提交说明和面向用户的说明，在没有特别规定时统一使用中文。

## 注释要求
- dto、model等结构体，参考com.yu.mboocode.model.Sessions类加上swagger注解
- 私有代码在理解成本较高添加注释，重点解释“为什么这样写”和“这段代码负责什么”。

## 代码风格
- 工具类尽量使用hutool库
- 业务异常抛com.yu.mboocode.common.exception.ServiceException
- 部分可以抽象的地方可以询问后抽象

## 单元测试
- 仅在我主动要求之后写单元测试

## 代码位置
- 比较通用的工具类可以在com.yu.mboocode.util包找或写入这个包