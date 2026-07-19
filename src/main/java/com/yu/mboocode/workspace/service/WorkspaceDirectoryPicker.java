package com.yu.mboocode.workspace.service;

import com.yu.mboocode.common.exception.ServiceException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.swing.JFileChooser;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;
import java.awt.GraphicsEnvironment;
import java.lang.reflect.InvocationTargetException;
import java.nio.file.Path;
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.atomic.AtomicReference;

@Service
@Slf4j
public class WorkspaceDirectoryPicker {
    private final ReentrantLock pickerLock = new ReentrantLock();

    public String selectDirectory() {
        if (!pickerLock.tryLock()) {
            throw new ServiceException("目录选择窗口已打开");
        }

        try {
            if (GraphicsEnvironment.isHeadless()) {
                throw new ServiceException("当前运行环境不支持目录选择");
            }

            AtomicReference<String> workspacePathRef = new AtomicReference<>();
            SwingUtilities.invokeAndWait(() -> workspacePathRef.set(showDirectoryChooser()));
            return workspacePathRef.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ServiceException("目录选择已中断");
        } catch (InvocationTargetException e) {
            log.error("打开目录选择窗口失败", e.getCause());
            throw new ServiceException("当前运行环境不支持目录选择");
        } finally {
            pickerLock.unlock();
        }
    }

    private String showDirectoryChooser() {
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        } catch (Exception e) {
            log.debug("加载系统界面风格失败，使用默认风格", e);
        }

        JFileChooser chooser = new JFileChooser(System.getProperty("user.home"));
        chooser.setDialogTitle("选择工作区");
        chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        chooser.setAcceptAllFileFilterUsed(false);
        if (chooser.showOpenDialog(null) != JFileChooser.APPROVE_OPTION) {
            return null;
        }
        Path selectedPath = chooser.getSelectedFile().toPath().toAbsolutePath().normalize();
        return selectedPath.toString();
    }
}
