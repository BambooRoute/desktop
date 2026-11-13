import { app } from 'electron'
import { configureInstalledApp } from './bamboo-installed-environment.mjs'

configureInstalledApp(app, process.resourcesPath)
