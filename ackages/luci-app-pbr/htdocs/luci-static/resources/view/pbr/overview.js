'use strict';
'require view';
'require form';
'require ui';
'require uci';
'require fs';
'require pbr.status as pbr';

var pkg = pbr.pkg;

return view.extend({
	load: function() {
		return Promise.all([
			pbr.getPlatformSupport(pkg.Name),
			pbr.getInterfaces(pkg.Name),
			fs.read_direct('/var/run/pbr_interface_status.json', 'json').catch(function() { return {}; }),
			fs.read('/etc/pbr.user').catch(function() { return '#!/bin/sh\n\n'; })
		]);
	},

	render: function(data) {
		var platform = (data[0] && data[0][pkg.Name]) ? data[0][pkg.Name] : {};
		var interfaces = (data[1] && data[1][pkg.Name] && data[1][pkg.Name].interfaces) ? data[1][pkg.Name].interfaces : [];
		var interfaceStatus = (data[2] && typeof data[2] === 'object') ? data[2] : {};
		var userScriptContent = (typeof data[3] === 'string') ? data[3] : '#!/bin/sh\n\n';

		var reply = {
			platform: platform,
			interfaces: interfaces
		};

		if (reply.interfaces.indexOf('ignore') === -1) {
			reply.interfaces.push('ignore');
		}

		var m, s, o;

		m = new form.Map(pkg.Name, _('Policy Routing - Configuration'));

		/* ================= 常规设置 General Settings ================= */
		s = m.section(form.NamedSection, 'config', pkg.Name, _('General Settings'));
		s.tab('tab_basic', _('Basic Settings'));
		s.tab('tab_advanced', _('Advanced Settings'));
		s.tab('tab_webui', _('Web UI Settings'));
		s.tab('tab_script', _('自定义脚本 (Custom Script)'));

		o = s.taboption('tab_basic', form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.rmempty = false;

		// 恢复原版日志输出级别 (verbosity)
		o = s.taboption('tab_basic', form.ListValue, 'verbosity', _('日志输出级别 (Verbosity)'),
			_('设置服务运行时的控制台与系统日志输出详细程度。'));
		o.value('0', _('0 - 仅严重错误 (静默)'));
		o.value('1', _('1 - 正常日志 (推荐)'));
		o.value('2', _('2 - 详细调试日志'));
		o.default = '1';

		// 严格执行 (Strict enforcement)
		o = s.taboption('tab_basic', form.ListValue, 'strict_enforcement', _('Strict enforcement'),
			_('Do not use default routes for marked traffic.'));
		o.value('0', _('Disabled'));
		o.value('1', _('Enabled'));
		o.default = '1';

		o = s.taboption('tab_basic', form.ListValue, 'resolver_set', _('Use Resolver Set'),
			_('Use resolver sets (dnsmasq ipset/nft set) for domain policies.'));
		o.value('none', _('Disabled'));
		if (platform.dnsmasq_ipset_support) {
			o.value('dnsmasq.ipset', _('Dnsmasq ipset'));
			o.default = 'dnsmasq.ipset';
		}
		if (platform.dnsmasq_nftset_support) {
			o.value('dnsmasq.nftset', _('Dnsmasq nft set'));
			o.default = 'dnsmasq.nftset';
		}

		o = s.taboption('tab_basic', form.ListValue, 'ipv6_enabled', _('IPv6 Support'));
		o.value('0', _('Disabled'));
		o.value('1', _('Enabled'));
		o.default = '0';

		o = s.taboption('tab_advanced', form.DynamicList, 'supported_interface', _('Supported Interfaces'),
			_('Allows to specify the list of interface names (in lower case) to be explicitly supported by the service.'));
		o.optional = false;

		o = s.taboption('tab_advanced', form.DynamicList, 'ignored_interface', _('Ignored Interfaces'),
			_('Allows to specify the list of interface names (in lower case) to be ignored by the service.'));
		o.optional = false;

		o = s.taboption('tab_advanced', form.ListValue, 'rule_create_option', _('Rule Create option'),
			_('Select Add for -A/add and Insert for -I/Insert.'));
		o.value('add', _('Add'));
		o.value('insert', _('Insert'));
		o.default = 'add';

		o = s.taboption('tab_advanced', form.ListValue, 'icmp_interface', _('Default ICMP Interface'),
			_('Force the ICMP protocol interface.'));
		o.value('', _('No Change'));
		reply.interfaces.forEach(function(element) {
			if (element.toLowerCase() !== 'ignore') {
				o.value(element);
			}
		});
		o.rmempty = true;

		o = s.taboption('tab_advanced', form.Value, 'wan_mark', _('WAN Table FW Mark'),
			_('Starting (WAN) FW Mark for marks used by the service.'));
		o.rmempty = true;
		o.placeholder = '010000';
		o.datatype = 'hexstring';

		o = s.taboption('tab_advanced', form.Value, 'fw_mask', _('Service FW Mask'),
			_('FW Mask used by the service.'));
		o.rmempty = true;
		o.placeholder = 'ff0000';
		o.datatype = 'hexstring';

		o = s.taboption('tab_webui', form.ListValue, 'webui_show_ignore_target', _('Add Ignore Target'),
			_('Adds "ignore" to the list of interfaces for policies.'));
		o.value('0', _('Disabled'));
		o.value('1', _('Enabled'));
		o.default = '0';
		o.optional = false;

		o = s.taboption('tab_webui', form.DynamicList, 'webui_supported_protocol', _('Supported Protocols'),
			_('Display these protocols in protocol column in Web UI.'));
		o.optional = false;

		/* ================= 自定义脚本 Tab (独立编辑保存，纯粹读写 /etc/pbr.user) ================= */
		o = s.taboption('tab_script', form.DummyValue, '_script_desc', _('监听网络变化后执行的自定义脚本'));
		o.rawhtml = true;
		o.default = '<div class="alert-message info" style="padding:10px 14px;line-height:1.8;border-radius:4px;margin-bottom:12px;">' +
			'<b>说明：</b>当网络接口发生状态变化（如物理插拔、拨号断开或 ICMP 探活假死/恢复）后，系统将自动调用此脚本执行企业微信/短信等告警通知。<br/>' +
			'<b>脚本路径：</b><code>/etc/pbr.user</code><br/>' +
			'<b>传递给脚本的环境变量：</b><br/>' +
			'• <code>$ACTION</code>: <code>connected</code> (探活恢复在线) / <code>disconnected</code> (假死离线) / <code>ifup</code> (接口物理连接) / <code>ifdown</code> (接口断开)<br/>' +
			'• <code>$INTERFACE</code>: 触发事件的接口名称（如 wan, wan2549, wan4603）<br/>' +
			'• <code>$DEVICE</code>: 接口绑定的物理设备名（如 pppoe-wan, lan2）' +
			'</div>';

		o = s.taboption('tab_script', form.DummyValue, '_custom_script_editor', _('脚本代码编辑'));
		o.rawhtml = true;
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			var textarea = E('textarea', {
				'id': 'pbr_user_script_content',
				'style': 'width: 100%; min-height: 420px; font-family: monospace; font-size: 13px; line-height: 1.5; padding: 10px; border: 1px solid #ccc; border-radius: 4px; background: #fafafa;',
				'wrap': 'off'
			}, [ userScriptContent ]);

			var saveBtn = E('button', {
				'class': 'cbi-button cbi-button-save',
				'style': 'margin-top: 10px; padding: 7px 22px; font-weight: bold; background: #0069d9; color: #fff; border-radius: 4px; border: none; cursor: pointer;',
				'click': function(ev) {
					ev.preventDefault();
					var val = (document.getElementById('pbr_user_script_content').value || '').trim().replace(/\r\n/g, '\n') + '\n';
					return fs.write('/etc/pbr.user', val).then(function() {
						return fs.chmod('/etc/pbr.user', '755');
					}).then(function() {
						ui.addNotification(null, E('p', '✓ 自定义脚本已成功保存到 /etc/pbr.user 并赋予执行权限！'), 'info');
					}).catch(function(err) {
						ui.addNotification(null, E('p', '保存脚本失败: ' + err.message), 'error');
					});
				}
			}, [ _('保存脚本 (Save Script)') ]);

			return E('div', { 'class': 'cbi-value-field', 'style': 'width: 100%;' }, [
				textarea,
				E('div', { 'style': 'margin-top: 8px; display: flex; align-items: center; justify-content: space-between;' }, [
					saveBtn,
					E('span', { 'style': 'color: #666; font-size: 12px;' }, '点击保存直接持久化写入 /etc/pbr.user')
				])
			]);
		};

		/* ================= 接口健康监测 Interface Health Tracking (对标 mwan3 汉化版) ================= */
		s = m.section(form.GridSection, 'interface', _('接口健康监测与故障自愈 (对标 mwan3)'),
			_('为每个 WAN 接口配置主动 ICMP 探测。当宽带发生持续丢包或假死断网时，系统自动从多 WAN 负载均衡池中剔除该接口，防止流量进入黑洞，并自动触发上方自定义脚本发送微信通知。'));
		s.rowcolors = true;
		s.sortable = false;
		s.anonymous = false;
		s.addremove = true;

		o = s.option(form.Flag, 'enabled', _('已启用'));
		o.default = '1';
		o.editable = true;

		// 实时在线/离线状态展示 (重写 cfgvalue 与 textvalue，稳定展示在线文本)
		o = s.option(form.DummyValue, '_status', _('实时状态'));
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			var st = interfaceStatus[section_id];
			if (st && st.status === 'online') {
				return '在线 (' + (st.device || section_id) + ')';
			} else if (st && st.status === 'offline') {
				return '离线已剔除';
			}
			return '在线 (正常)';
		};
		o.textvalue = function(section_id) {
			return this.cfgvalue(section_id);
		};

		o = s.option(form.DynamicList, 'track_ip', _('探测目标 IP'));
		o.datatype = 'ip4addr';
		o.placeholder = '119.29.29.29';
		o.rmempty = false;

		o = s.option(form.Value, 'interval', _('探测周期 (秒)'));
		o.datatype = 'uinteger';
		o.default = '5';
		o.placeholder = '5';
		o.rmempty = true;

		o = s.option(form.Value, 'down', _('判定离线阈值'));
		o.datatype = 'uinteger';
		o.default = '3';
		o.placeholder = '3';
		o.rmempty = true;

		o = s.option(form.Value, 'up', _('判定恢复阈值'));
		o.datatype = 'uinteger';
		o.default = '3';
		o.placeholder = '3';
		o.rmempty = true;

		/* ================= 策略列表 Policies (支持多网口与权重聚合) ================= */
		s = m.section(form.GridSection, 'policy', _('Policies'),
			_('Name, interface and at least one other field are required. Multiple local and remote addresses/devices/domains and ports can be space separated. For multi-WAN load balancing, specify multiple interfaces with optional weights (e.g. "wan2549:2 wan4603:3").'));
		s.rowcolors = true;
		s.sortable = true;
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.editable = true;

		o = s.option(form.Value, 'name', _('Name'));

		o = s.option(form.Value, 'src_addr', _('Local addresses / devices'));
		o.datatype = 'list(neg(or(cidr,host,ipmask,ipaddr,macaddr,network,string)))';
		o.rmempty = true;
		o.default = '';

		o = s.option(form.Value, 'src_port', _('Local ports'));
		o.datatype = 'list(neg(or(portrange,port)))';
		o.placeholder = '0-65535';
		o.rmempty = true;
		o.default = '';

		o = s.option(form.Value, 'dest_addr', _('Remote addresses / domains'));
		o.datatype = 'list(neg(or(cidr,host,ipmask,ipaddr,macaddr,network,string)))';
		o.rmempty = true;
		o.default = '';

		o = s.option(form.Value, 'dest_port', _('Remote ports'));
		o.datatype = 'list(neg(or(portrange,port)))';
		o.placeholder = '0-65535';
		o.rmempty = true;
		o.default = '';

		o = s.option(form.ListValue, 'proto', _('Protocol'));
		var proto = L.toArray(uci.get(pkg.Name, 'config', 'webui_supported_protocol'));
		if (!proto.length) {
			proto = ['all', 'tcp', 'udp', 'tcp udp', 'icmp'];
		}
		proto.forEach(function(element) {
			if (element === 'all') {
				o.value('', _('all'));
				o.default = '';
			} else {
				o.value(element.toLowerCase());
			}
		});
		o.rmempty = true;

		o = s.option(form.ListValue, 'chain', _('Chain'));
		o.value('', 'prerouting');
		o.value('forward', 'forward');
		o.value('input', 'input');
		o.value('output', 'output');
		o.value('postrouting', 'postrouting');
		o.default = '';
		o.rmempty = true;

		/* ===== 核心：接口 MultiValue 智能下拉打勾多选与带权重自定义 ===== */
		o = s.option(form.MultiValue, 'interface', _('Interface'));
		reply.interfaces.forEach(function(element) {
			o.value(element);
		});
		o.rmempty = false;

		// 1. 读取时智能拆分空格分隔的网口，保证现有配置 (如 wan2549:2 wan4603:3) 精准打勾回显
		o.cfgvalue = function(section_id) {
			var val = this.map.data.get(this.config, section_id, this.option);
			if (!val) return [];
			if (Array.isArray(val)) return val;
			return String(val).trim().split(/\s+/).filter(Boolean);
		};

		// 2. 渲染交互组件：打勾多选已发现的网口，同时支持手动输入带权重的网口
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			var value = (cfgvalue != null) ? cfgvalue : this.default;
			var choices = this.transformChoices();
			var valArr = L.toArray(value);

			// 确保已配置的值（即使带权重后缀 :2）显示在 choices 中，防止匹配丢失
			valArr.forEach(function(v) {
				if (v && !choices[v]) {
					choices[v] = v;
				}
			});

			var widget = new ui.Dropdown(valArr, choices, {
				id: this.cbid(section_id),
				sort: this.keylist,
				multiple: true,
				create: true, // 允许输入自定义格式 (如 wan2549:2)
				optional: this.optional || this.rmempty,
				select_placeholder: this.placeholder || _('-- Please choose --'),
				display_items: this.display_size || this.size || 5,
				dropdown_items: this.dropdown_size || this.size || -1,
				validate: L.bind(this.validate, this, section_id),
				disabled: (this.readonly != null) ? this.readonly : this.map.readonly
			});
			return widget.render();
		};

		// 3. 保存时将选中的多个接口以空格拼接为单行字符串写入 UCI
		o.write = function(section_id, formvalue) {
			var val = Array.isArray(formvalue) ? formvalue.join(' ') : formvalue;
			return this.map.data.set(this.config, section_id, this.option, val);
		};

		/* ================= DNS 策略 DNS Policies ================= */
		s = m.section(form.GridSection, 'dns_policy', _('DNS Policies'),
			_('Name, local address and remote DNS fields are required. Multiple local addresses/devices can be space separated.'));
		s.rowcolors = true;
		s.sortable = true;
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.editable = true;

		o = s.option(form.Value, 'name', _('Name'));
		o.optional = false;

		o = s.option(form.Value, 'src_addr', _('Local addresses / devices'));
		o.optional = false;
		o.datatype = 'list(neg(or(cidr,host,ipmask,ipaddr,macaddr,network,string)))';
		o.rmempty = true;
		o.default = '';

		o = s.option(form.Value, 'dest_dns', _('Remote DNS'));
		o.optional = false;
		o.rmempty = false;
		o.datatype = 'list(or(cidr,host,network,ipaddr))';
		reply.interfaces.forEach(function(element) {
			if (element !== 'ignore') {
				o.value(element);
			}
		});

		/* ================= DSCP Tagging ================= */
		s = m.section(form.NamedSection, 'config', pkg.Name, _('DSCP Tagging'),
			_('Set DSCP tags (in range between 1 and 63) for specific interfaces.'));
		reply.interfaces.forEach(function(element) {
			if (element.toLowerCase() !== 'ignore') {
				o = s.option(form.Value, element + '_dscp', element.toUpperCase() + ' ' + _('DSCP Tag'));
				o.datatype = 'and(uinteger, min(1), max(63))';
			}
		});

		/* ================= Custom User File Includes ================= */
		s = m.section(form.GridSection, 'include', _('Custom User File Includes'),
			_('Run the following user files after setting up but before restarting DNSMASQ.'));
		s.sortable = true;
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.optional = false;
		o.editable = true;
		o.rmempty = false;

		o = s.option(form.Value, 'path', _('Path'));
		o.optional = false;
		o.editable = true;
		o.rmempty = false;

		var statusWidget = new pbr.status();
		return Promise.all([statusWidget.render(), m.render()]);
	}
});
