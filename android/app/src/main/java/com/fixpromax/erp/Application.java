package com.fixpromax.erp;

import android.app.Application;
import com.google.androidbrowserhelper.trusted.TwaSessionHelper;

public class Application extends android.app.Application {
    @Override
    public void onCreate() {
        super.onCreate();
        // Inicialización del helper TWA
        TwaSessionHelper.getInstance(this);
    }
}
