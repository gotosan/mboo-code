package com.yu.mboocode.common.handler;

import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.common.dto.R;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.support.DefaultMessageSourceResolvable;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 全局Controller异常捕捉器，注意：捕获异常的优先级会按方法定义的顺序来捕获
 */
@ControllerAdvice
@ResponseBody
@Slf4j
public class GlobalExceptionHandler {
    //校验异常
    @ExceptionHandler({MethodArgumentNotValidException.class, BindException.class})
    public R<Void> validExceptionHandler(HttpServletResponse response, Exception ex) {
        String msg;
        if (ex instanceof MethodArgumentNotValidException) {
            msg = ((MethodArgumentNotValidException) ex).getBindingResult().getFieldErrors().stream().map(DefaultMessageSourceResolvable::getDefaultMessage).collect(Collectors.joining(";"));
        } else if (ex instanceof BindException) {
            msg = ((BindException) ex).getBindingResult().getFieldErrors().stream().map(DefaultMessageSourceResolvable::getDefaultMessage).collect(Collectors.joining(";"));
        } else {
            msg = ex.getMessage();
        }
        return R.failed(msg);
    }

    //controller数据绑定异常
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public R<Void> fieldExceptionHandler(HttpServletResponse response, HttpMessageNotReadableException ex) {
        String msg = null;
        Throwable cause = ex.getCause();
        if (cause instanceof InvalidFormatException e) {
            msg += "字段'" + e.getPath().getLast().getFieldName() + "'类型错误，应为" + e.getTargetType().getSimpleName() + "类型";
        } else {
            msg = cause.getCause().getMessage();
        }
        return R.failed(msg);
    }

    private static final Pattern FIELD_PATTERN = Pattern.compile("'(.*?)'");

    //业务异常
    @ExceptionHandler(ServiceException.class)
    public R<Void> serviceExceptionHandler(Exception e) {
        return R.failed(e.getMessage());
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public R<Void> missingServletRequestParameterExceptionHandler(Exception e) {
        String field = "";
        String str = e.getMessage();
        Matcher matcher = FIELD_PATTERN.matcher(str);
        if (matcher.find()) {
            field = matcher.group(1);  // 用 group(1) 去掉引号
        }
        return R.failed(String.format("字段 %s 不可为空", field));
    }

    //其他未捕获的异常
    @ExceptionHandler(Exception.class)
    public R<Void> otherExceptionHandler(HttpServletResponse response, Exception ex) {
        log.error(ex.getMessage(), ex);
        return R.failed("服务器内部错误，请联系管理员", ex.getMessage());
    }
}
