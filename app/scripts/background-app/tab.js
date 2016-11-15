// @flow

import log from 'loglevel';

export type TabMap = { [key: string]: FWTabInfo };

const allTabs: TabMap = {};
export class FWTabInfo {
  tabId: number;
  url: string;
  capturedAdCount: number;

  static allTabs(): TabMap {
    return allTabs;
  }

  static loadTabs(): Promise<void> {
    return new Promise((resolve) => {
      function createTabInfo(tab: chrome$Tab) {
        if (tab.id !== undefined && tab.id >= 0 && tab.url !== undefined) {
          const tabInfo = new FWTabInfo(tab.id);
          tabInfo.setUrl(tab.url);

          allTabs[tabInfo.tabId.toString()] = tabInfo;
        }
      }

      chrome.tabs.query({}, (tabs: chrome$Tab[]) => {
        for (const tab of tabs) {
          createTabInfo(tab);
        }

        chrome.tabs.onRemoved.addListener((tabId: number) => {
          delete allTabs[tabId.toString()];
        });

        chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: Object, tab: chrome$Tab) => {
          const tabInfo: ?FWTabInfo = allTabs[tabId.toString()];

          if (!tabInfo) {
            createTabInfo(tab);
          } else if (changeInfo.url) {
            tabInfo.setUrl(changeInfo.url);
          }
        });

        resolve();
      });
    });
  }

  static incrTabAdCount(tabId: number): ?number {
    const tabInfo: ?FWTabInfo = allTabs[tabId.toString()];
    if (!tabInfo) {
      return null;
    } else {
      return tabInfo.capturedAd();
    }
  }

  static getTabAdCount(tabId: number): ?number {
    const tabInfo: ?FWTabInfo = allTabs[tabId.toString()];
    if (!tabInfo) {
      return null;
    } else {
      return tabInfo.capturedAdCount;
    }
  }

  constructor(tabId: number) {
    this.tabId = tabId;
    this.capturedAdCount = 0;
    this.updateStorage();
  }

  setUrl(url: string) {
    if (url != this.url) {
      this.capturedAdCount = 0;
      this.updateStorage();
    }

    this.url = url;
  }

  getStorageCountId() {
    return `tab-${this.tabId}-count`;
  }

  capturedAd(): number {
    this.capturedAdCount++;
    this.updateStorage();
    return this.capturedAdCount;
  }

  updateStorage() {
    log.debug('incrementing', this.getStorageCountId());
    const data = {};
    data[this.getStorageCountId()] = this.capturedAdCount;
    chrome.storage.local.set(data, () => {
      log.debug('done incrementing', this.getStorageCountId());
    });
  }
}
