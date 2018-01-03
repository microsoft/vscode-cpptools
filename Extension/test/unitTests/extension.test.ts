/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import * as os from 'os';
import { LinuxDistribution } from '../../src/linuxDistribution';
import { WmicProcessParser, PsProcessParser } from '../../src/Debugger/nativeAttach';

suite("LinuxDistro Tests", () => {
    test("Parse valid os-release file", () => {
        const dataUbuntu1404 = 'NAME="Ubuntu"' + os.EOL +
                               'VERSION="14.04.4 LTS, Trusty Tahr"' + os.EOL +
                               'ID=ubuntu' + os.EOL +
                               'ID_LIKE=debian' + os.EOL +
                               'PRETTY_NAME="Ubuntu 14.04.4 LTS"' + os.EOL +
                               'VERSION_ID="14.04"' + os.EOL +
                               'HOME_URL="http://www.ubuntu.com/"' + os.EOL +
                               'SUPPORT_URL="http://help.ubuntu.com/"' + os.EOL +
                               'BUG_REPORT_URL="http://bugs.launchpad.net/ubuntu/"';

        const dataUbuntu1510 = 'NAME="Ubuntu"' + os.EOL +
                               'VERSION="15.10 (Wily Werewolf)"' + os.EOL +
                               'ID=ubuntu' + os.EOL +
                               'ID_LIKE=debian' + os.EOL +
                               'PRETTY_NAME="Ubuntu 15.10"' + os.EOL +
                               'VERSION_ID="15.10"' + os.EOL +
                               'HOME_URL="http://www.ubuntu.com/"' + os.EOL +
                               'SUPPORT_URL="http://help.ubuntu.com/"' + os.EOL +
                               'BUG_REPORT_URL="http://bugs.launchpad.net/ubuntu/"';

        const dataCentos73 = 'NAME="CentOS Linux"' + os.EOL +
                             'VERSION="7 (Core)"' + os.EOL +
                             'ID="centos"' + os.EOL +
                             'ID_LIKE="rhel fedora"' + os.EOL +
                             'VERSION_ID="7"' + os.EOL +
                             'PRETTY_NAME="CentOS Linux 7 (Core)"' + os.EOL +
                             'ANSI_COLOR="0;31"' + os.EOL +
                             'CPE_NAME="cpe:/o:centos:centos:7"' + os.EOL +
                             'HOME_URL="https://www.centos.org/"' + os.EOL +
                             'BUG_REPORT_URL="https://bugs.centos.org/"' + os.EOL +
                             os.EOL +
                             'CENTOS_MANTISBT_PROJECT="CentOS-7"' + os.EOL +
                             'CENTOS_MANTISBT_PROJECT_VERSION="7"' + os.EOL +
                             'REDHAT_SUPPORT_PRODUCT="centos"' + os.EOL +
                             'REDHAT_SUPPORT_PRODUCT_VERSION="7"';

        let ubuntu1404 = LinuxDistribution.getDistroInformation(dataUbuntu1404);
        let ubuntu1510 = LinuxDistribution.getDistroInformation(dataUbuntu1510);
        let centos73 = LinuxDistribution.getDistroInformation(dataCentos73);

        assert.equal(ubuntu1404.name, 'ubuntu');
        assert.equal(ubuntu1404.version, '"14.04"');

        assert.equal(ubuntu1510.name, 'ubuntu');
        assert.equal(ubuntu1510.version, '"15.10"');

        assert.equal(centos73.name, '"centos"');
        assert.equal(centos73.version, '"7"');
    });

    test("Parse invalid os-release file", () => {
        const data = 'garbage"';

        let unknown = LinuxDistribution.getDistroInformation(data);
        assert.equal(unknown.name, 'unknown');
        assert.equal(unknown.version, 'unknown');
    });
});

suite("Pick Process Tests", () => {
    test("Parse valid wmic output", () => {
        // output from the command used in WmicAttachItemsProvider
        const wmicOutput = 'CommandLine=' + os.EOL +
                           'Name=System Idle Process' + os.EOL +
                           'ProcessId=0' + os.EOL +
                           '' + os.EOL +
                           '' + os.EOL +
                           'CommandLine="C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\ONENOTE.EXE"' + os.EOL +
                           'Name=ONENOTE.EXE' + os.EOL +
                           'ProcessId=6540' + os.EOL +
                           '' + os.EOL +
                           '' + os.EOL +
                           `CommandLine=\\??\\C:\\windows\\system32\\conhost.exe 0x4` + os.EOL +
                           'Name=conhost.exe' + os.EOL +
                           'ProcessId=59148' + os.EOL;

        let parsedOutput = WmicProcessParser.ParseProcessFromWmic(wmicOutput);

        let process1 = parsedOutput[0];
        let process2 = parsedOutput[1];
        let process3 = parsedOutput[2];

        assert.equal(process1.commandLine, '');
        assert.equal(process1.name, 'System Idle Process');
        assert.equal(process1.pid, '0');

        assert.equal(process2.commandLine, '"C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\ONENOTE.EXE"');
        assert.equal(process2.name, 'ONENOTE.EXE');
        assert.equal(process2.pid, '6540');

        assert.equal(process3.commandLine, 'C:\\windows\\system32\\conhost.exe 0x4');
        assert.equal(process3.name, 'conhost.exe');
        assert.equal(process3.pid, '59148');
    });

    test("Parse valid ps output", () => {
        // output from the command used in PsAttachItemsProvider
        const psOutput = '      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' + os.EOL +
                         '15470 ScopedBookmarkAgent                                ScopedBookmarkAgent' + os.EOL +
                         '15220 mdworker                                           mdworker -s mdworker -c MDSImporterWorker -m com.apple.mdworker.shared' + os.EOL;

        let parsedOutput = PsProcessParser.ParseProcessFromPs(psOutput);

        let process1 = parsedOutput[0];
        let process2 = parsedOutput[1];
        let process3 = parsedOutput[2];

        assert.equal(process1.commandLine, 'ScopedBookmarkAgent');
        assert.equal(process1.name, 'ScopedBookmarkAgent');
        assert.equal(process1.pid, '15470');

        assert.equal(process2.commandLine, 'mdworker -s mdworker -c MDSImporterWorker -m com.apple.mdworker.shared');
        assert.equal(process2.name, 'mdworker');
        assert.equal(process2.pid, '15220');
    });
});
