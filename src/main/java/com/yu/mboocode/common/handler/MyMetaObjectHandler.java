package com.yu.mboocode.common.handler;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import com.yu.mboocode.util.DateTimeUtil;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.context.annotation.Configuration;

import java.util.Objects;
import java.util.function.Supplier;

@Configuration
public class MyMetaObjectHandler implements MetaObjectHandler {
    @Override
    public void insertFill(MetaObject metaObject) {
        this.strictInsertFill(metaObject, "createdAt", DateTimeUtil::now, String.class);
        this.strictInsertFill(metaObject, "updatedAt", DateTimeUtil::now, String.class);
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        this.strictUpdateFill(metaObject, "updatedAt", DateTimeUtil::now, String.class);
    }

    @Override
    public MetaObjectHandler strictFillStrategy(MetaObject metaObject, String fieldName, Supplier<?> fieldVal) {
        if (Objects.equals(fieldName, "updatedAt") || metaObject.getValue(fieldName) == null) {
            Object obj = fieldVal.get();
            if (Objects.nonNull(obj)) {
                metaObject.setValue(fieldName, obj);
            }
        }
        return this;
    }
}
