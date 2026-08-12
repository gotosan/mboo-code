package com.yu.mboocode.common.dto;

import com.yu.mboocode.common.enums.ResultEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;


@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "统一返回JSON")
public class R<T> {
    @Schema(description = "状态：true成功，false失败")
    private boolean success;

    @Schema(description = "返回结果")
    private T data;

    @Schema(description = "状态码")
    private Integer code;

    @Schema(description = "提示信息")
    private String msg;

    @Schema(description = "报错信息")
    private String exception;

    public static <T> R<T> ok() {
        return new R<>(true, null, ResultEnum.SUCCESS.getCode(), ResultEnum.SUCCESS.getMsg(), "");
    }

    public static <T> R<T> ok(T data) {
        return new R<>(true, data, ResultEnum.SUCCESS.getCode(), ResultEnum.SUCCESS.getMsg(), "");
    }

    public static <T> R<T> ok(T data, String msg) {
        return new R<>(true, data, ResultEnum.SUCCESS.getCode(), msg, "");
    }

    public static <T> R<T> failed() {
        return new R<>(false, null, ResultEnum.FAILED.getCode(), ResultEnum.FAILED.getMsg(), "");
    }

    public static <T> R<T> failed(String msg) {
        return new R<>(false, null, ResultEnum.FAILED.getCode(), msg, "");
    }

    public static <T> R<T> failed(String msg, String exception) {
        return new R<>(false, null, ResultEnum.FAILED.getCode(), msg, exception);
    }

    public static <T> R<T> failed(ResultEnum resultEnum) {
        return new R<>(false, null, resultEnum.getCode(), resultEnum.getMsg(), "");
    }

    public static <T> R<T> failed(ResultEnum resultEnum, T data) {
        return new R<>(false, data, resultEnum.getCode(), resultEnum.getMsg(), "");
    }
}
