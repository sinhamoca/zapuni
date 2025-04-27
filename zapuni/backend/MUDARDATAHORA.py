#!/usr/bin/env python3
"""
Utilitário para gerenciar configurações de assinaturas e lembretes
Este script permite modificar facilmente horários, intervalos e mensagens de lembretes
"""

import os
import re
import sys
import json
import argparse
from datetime import datetime

# Configurações padrão
DEFAULT_CONFIG = {
    "reminder_time": 9,  # Hora do dia (9h da manhã)
    "reminder_days": [0, 3, 7],  # Dias antes do vencimento
    "message_templates": {
        "today": "Olá {user_name}! Seu plano *{product_name}* vence *hoje*. Para renovar, basta enviar a palavra *COMPRAR* e seguir as instruções. Ao renovar hoje, você evita a interrupção do serviço. Obrigado pela preferência!",
        "tomorrow": "Olá {user_name}! Seu plano *{product_name}* vence *amanhã*. Para renovar, basta enviar a palavra *COMPRAR* e seguir as instruções. Obrigado pela preferência!",
        "days": "Olá {user_name}! Seu plano *{product_name}* vence em *{days_left} dias*. Para renovar antecipadamente, basta enviar a palavra *COMPRAR* e seguir as instruções. Obrigado pela preferência!"
    }
}

# Caminhos dos arquivos
CONFIG_PATH = "subscription_config.json"
MAIN_PY_PATH = "main.py"
SCHEDULER_PY_PATH = "subscription_scheduler.py"

def clear_screen():
    """Limpa a tela do terminal"""
    os.system('cls' if os.name == 'nt' else 'clear')

def load_config():
    """Carrega configurações do arquivo ou usa os padrões"""
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Erro ao carregar configurações: {e}")
            return DEFAULT_CONFIG
    else:
        # Se o arquivo não existe, criar com configurações padrão
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG

def save_config(config):
    """Salva configurações no arquivo JSON"""
    try:
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Erro ao salvar configurações: {e}")
        return False

def detect_project_files():
    """Detecta arquivos do projeto para aplicar alterações"""
    missing_files = []
    if not os.path.exists(MAIN_PY_PATH):
        missing_files.append(MAIN_PY_PATH)
    if not os.path.exists(SCHEDULER_PY_PATH):
        missing_files.append(SCHEDULER_PY_PATH)
    
    return missing_files

def update_reminder_time(config, hour):
    """Atualiza o horário de envio dos lembretes no arquivo main.py"""
    if not os.path.exists(MAIN_PY_PATH):
        print(f"Arquivo {MAIN_PY_PATH} não encontrado!")
        return False
    
    try:
        with open(MAIN_PY_PATH, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Procura pelo padrão de definição do horário
        pattern = r'target_hour\s*=\s*\d+'
        replacement = f'target_hour = {hour}'
        
        if re.search(pattern, content):
            updated_content = re.sub(pattern, replacement, content)
            
            with open(MAIN_PY_PATH, 'w', encoding='utf-8') as f:
                f.write(updated_content)
            
            config['reminder_time'] = hour
            save_config(config)
            return True
        else:
            print("Não foi possível encontrar onde definir o horário no arquivo main.py")
            return False
    
    except Exception as e:
        print(f"Erro ao atualizar horário: {e}")
        return False

def update_reminder_days(config, days):
    """Atualiza os dias para envio de lembretes no arquivo subscription_scheduler.py"""
    if not os.path.exists(SCHEDULER_PY_PATH):
        print(f"Arquivo {SCHEDULER_PY_PATH} não encontrado!")
        return False
    
    try:
        with open(SCHEDULER_PY_PATH, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Procura pelo padrão de definição dos dias
        pattern = r'reminder_days\s*=\s*\[\s*[\d,\s]*\s*\]'
        days_str = ', '.join(map(str, days))
        replacement = f'reminder_days = [{days_str}]'
        
        if re.search(pattern, content):
            updated_content = re.sub(pattern, replacement, content)
            
            with open(SCHEDULER_PY_PATH, 'w', encoding='utf-8') as f:
                f.write(updated_content)
            
            config['reminder_days'] = days
            save_config(config)
            return True
        else:
            print("Não foi possível encontrar onde definir os dias no arquivo subscription_scheduler.py")
            return False
    
    except Exception as e:
        print(f"Erro ao atualizar dias de lembrete: {e}")
        return False

def update_message_templates(config, template_type, new_template):
    """Atualiza os templates de mensagem no arquivo subscription_scheduler.py"""
    if not os.path.exists(SCHEDULER_PY_PATH):
        print(f"Arquivo {SCHEDULER_PY_PATH} não encontrado!")
        return False
    
    try:
        with open(SCHEDULER_PY_PATH, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Determinar qual padrão procurar com base no tipo de template
        if template_type == "today":
            pattern = r'message\s*=\s*\(\s*f".*?vence\s*\*hoje\*.*?"\s*\)'
        elif template_type == "tomorrow":
            pattern = r'message\s*=\s*\(\s*f".*?vence\s*\*amanhã\*.*?"\s*\)'
        elif template_type == "days":
            pattern = r'message\s*=\s*\(\s*f".*?vence\s*em\s*\*{days_left}\s*dias\*.*?"\s*\)'
        else:
            print(f"Tipo de template desconhecido: {template_type}")
            return False
        
        # Escape das chaves no f-string
        escaped_template = new_template.replace("{", "{{").replace("}", "}}")
        # Restaurar as variáveis específicas
        escaped_template = escaped_template.replace("{{user_name}}", "{user.name or ''}")
        escaped_template = escaped_template.replace("{{product_name}}", "{product_name}")
        escaped_template = escaped_template.replace("{{days_left}}", "{days_left}")
        
        replacement = f'message = (\n            f"{escaped_template}"\n        )'
        
        if re.search(pattern, content, re.DOTALL):
            updated_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
            
            with open(SCHEDULER_PY_PATH, 'w', encoding='utf-8') as f:
                f.write(updated_content)
            
            config['message_templates'][template_type] = new_template
            save_config(config)
            return True
        else:
            print(f"Não foi possível encontrar onde definir o template '{template_type}' no arquivo subscription_scheduler.py")
            return False
    
    except Exception as e:
        print(f"Erro ao atualizar template de mensagem: {e}")
        return False

def display_menu():
    """Exibe o menu principal"""
    clear_screen()
    print("=" * 60)
    print("  GERENCIADOR DE CONFIGURAÇÕES DE ASSINATURAS E LEMBRETES")
    print("=" * 60)
    print("\nEscolha uma opção:")
    print("1. Alterar horário de envio dos lembretes")
    print("2. Configurar dias para envio de lembretes")
    print("3. Editar mensagens de lembrete")
    print("4. Exibir configurações atuais")
    print("5. Restaurar configurações padrão")
    print("6. Sair")
    
    choice = input("\nOpção: ")
    return choice

def time_menu(config):
    """Menu para alterar o horário de envio"""
    clear_screen()
    print("=" * 60)
    print("  ALTERAÇÃO DE HORÁRIO DE ENVIO")
    print("=" * 60)
    print(f"\nHorário atual: {config['reminder_time']}:00")
    print("\nDigite o novo horário (0-23) ou 'c' para cancelar:")
    
    choice = input("\nNovo horário: ")
    if choice.lower() == 'c':
        return False
    
    try:
        hour = int(choice)
        if 0 <= hour <= 23:
            if update_reminder_time(config, hour):
                print(f"\nHorário atualizado para {hour}:00!")
                input("\nPressione Enter para continuar...")
                return True
            else:
                print("\nFalha ao atualizar o horário. Verifique os logs.")
                input("\nPressione Enter para continuar...")
                return False
        else:
            print("\nHorário inválido. Use um valor entre 0 e 23.")
            input("\nPressione Enter para continuar...")
            return False
    except ValueError:
        print("\nEntrada inválida. Digite um número entre 0 e 23.")
        input("\nPressione Enter para continuar...")
        return False

def days_menu(config):
    """Menu para configurar dias de lembrete"""
    clear_screen()
    print("=" * 60)
    print("  CONFIGURAÇÃO DE DIAS PARA LEMBRETES")
    print("=" * 60)
    print(f"\nDias atuais: {config['reminder_days']}")
    print("\nDigite os novos dias separados por vírgula (ex: 0,3,7)")
    print("0 = dia do vencimento, 1 = 1 dia antes, etc.")
    print("Digite 'c' para cancelar.")
    
    choice = input("\nNovos dias: ")
    if choice.lower() == 'c':
        return False
    
    try:
        days = [int(day.strip()) for day in choice.split(',')]
        days.sort()  # Ordenar os dias
        
        if len(days) == 0:
            print("\nVocê deve especificar pelo menos um dia.")
            input("\nPressione Enter para continuar...")
            return False
        
        if any(d < 0 for d in days):
            print("\nDias negativos não são permitidos.")
            input("\nPressione Enter para continuar...")
            return False
        
        if update_reminder_days(config, days):
            print(f"\nDias de lembrete atualizados para {days}!")
            input("\nPressione Enter para continuar...")
            return True
        else:
            print("\nFalha ao atualizar os dias de lembrete. Verifique os logs.")
            input("\nPressione Enter para continuar...")
            return False
    except ValueError:
        print("\nEntrada inválida. Use números separados por vírgula.")
        input("\nPressione Enter para continuar...")
        return False

def message_menu(config):
    """Menu para editar mensagens de lembrete"""
    while True:
        clear_screen()
        print("=" * 60)
        print("  EDIÇÃO DE MENSAGENS DE LEMBRETE")
        print("=" * 60)
        print("\nEscolha qual mensagem editar:")
        print("1. Mensagem para o dia do vencimento")
        print("2. Mensagem para o dia anterior ao vencimento")
        print("3. Mensagem para dias antes do vencimento")
        print("4. Voltar ao menu principal")
        
        choice = input("\nOpção: ")
        
        if choice == '1':
            edit_message(config, "today")
        elif choice == '2':
            edit_message(config, "tomorrow")
        elif choice == '3':
            edit_message(config, "days")
        elif choice == '4':
            return
        else:
            print("\nOpção inválida. Tente novamente.")
            input("\nPressione Enter para continuar...")

def edit_message(config, template_type):
    """Edita um template de mensagem específico"""
    clear_screen()
    
    template_names = {
        "today": "dia do vencimento", 
        "tomorrow": "dia anterior ao vencimento", 
        "days": "dias antes do vencimento"
    }
    
    print("=" * 60)
    print(f"  EDIÇÃO DE MENSAGEM PARA {template_names[template_type].upper()}")
    print("=" * 60)
    
    current_template = config['message_templates'][template_type]
    print("\nMensagem atual:")
    print("-" * 60)
    print(current_template)
    print("-" * 60)
    
    print("\nVariáveis disponíveis:")
    print("{user_name} - Nome do cliente")
    print("{product_name} - Nome do produto/plano")
    if template_type == "days":
        print("{days_left} - Dias restantes até o vencimento")
    
    print("\nDigite a nova mensagem ou 'c' para cancelar:")
    print("(Para enviar, pressione Enter e depois digite '.' em uma linha vazia)")
    
    lines = []
    while True:
        line = input()
        if line == '.':
            break
        if line.lower() == 'c' and not lines:
            return
        lines.append(line)
    
    if not lines:
        print("\nOperação cancelada.")
        input("\nPressione Enter para continuar...")
        return
    
    new_template = '\n'.join(lines)
    
    if update_message_templates(config, template_type, new_template):
        print(f"\nMensagem para {template_names[template_type]} atualizada com sucesso!")
    else:
        print("\nFalha ao atualizar a mensagem. Verifique os logs.")
    
    input("\nPressione Enter para continuar...")

def display_current_config(config):
    """Exibe as configurações atuais"""
    clear_screen()
    print("=" * 60)
    print("  CONFIGURAÇÕES ATUAIS")
    print("=" * 60)
    
    print(f"\nHorário de envio: {config['reminder_time']}:00")
    print(f"Dias para lembrete: {config['reminder_days']}")
    
    print("\nMensagens de lembrete:")
    print("\n1. Dia do vencimento:")
    print("-" * 60)
    print(config['message_templates']['today'])
    print("-" * 60)
    
    print("\n2. Dia anterior ao vencimento:")
    print("-" * 60)
    print(config['message_templates']['tomorrow'])
    print("-" * 60)
    
    print("\n3. Dias antes do vencimento:")
    print("-" * 60)
    print(config['message_templates']['days'])
    print("-" * 60)
    
    input("\nPressione Enter para continuar...")

def restore_defaults(config):
    """Restaura configurações padrão"""
    clear_screen()
    print("=" * 60)
    print("  RESTAURAR CONFIGURAÇÕES PADRÃO")
    print("=" * 60)
    
    print("\nATENÇÃO: Isso restaurará TODAS as configurações para seus valores padrão.")
    print("Deseja continuar? (s/n)")
    
    choice = input("\nOpção: ")
    if choice.lower() != 's':
        print("\nOperação cancelada.")
        input("\nPressione Enter para continuar...")
        return
    
    # Atualizar configurações para valores padrão
    update_reminder_time(DEFAULT_CONFIG, DEFAULT_CONFIG['reminder_time'])
    update_reminder_days(DEFAULT_CONFIG, DEFAULT_CONFIG['reminder_days'])
    
    for template_type, template in DEFAULT_CONFIG['message_templates'].items():
        update_message_templates(DEFAULT_CONFIG, template_type, template)
    
    print("\nConfiguração padrão restaurada com sucesso!")
    input("\nPressione Enter para continuar...")

def main():
    """Função principal do programa"""
    # Verificar arquivos do projeto
    missing_files = detect_project_files()
    if missing_files:
        print("AVISO: Os seguintes arquivos do projeto não foram encontrados:")
        for file in missing_files:
            print(f"- {file}")
        print("\nVocê precisa executar este script no diretório do projeto,")
        print("ou copiar os arquivos do projeto para o diretório atual.")
        print("\nApenas a visualização de configurações estará disponível.")
        input("\nPressione Enter para continuar...")
    
    # Carregar configurações
    config = load_config()
    
    while True:
        choice = display_menu()
        
        if choice == '1':
            time_menu(config)
        elif choice == '2':
            days_menu(config)
        elif choice == '3':
            message_menu(config)
        elif choice == '4':
            display_current_config(config)
        elif choice == '5':
            restore_defaults(config)
        elif choice == '6':
            clear_screen()
            print("Saindo do gerenciador de configurações...")
            sys.exit(0)
        else:
            print("\nOpção inválida. Tente novamente.")
            input("\nPressione Enter para continuar...")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nPrograma encerrado pelo usuário.")
        sys.exit(0)
